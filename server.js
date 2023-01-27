const express = require('express');
const path = require('path');
let bodyParser = require('body-parser');
const mongoose = require('mongoose');
const User = require('./model/user');
const bcrypt = require('bcryptjs');
const session = require("express-session");
const Reservation = require('./model/reservation');
const Resource = require('./model/resource');
const rateLimit = require("express-rate-limit");
const debug = require("debug")("http");
require('dotenv').config();
const morgan = require("morgan");


// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
	useNewUrlParser: true,
	useUnifiedTopology: true
});


const app = express();


// Initialize the session
app.use(session({
	secret: 'top secret',
	resave: true,
	saveUninitialized: true
}));


app.use(morgan("tiny"));

app.use(bodyParser.urlencoded({
	extended: true
}));

//set up the views frontend
app.use(express.static(path.join(__dirname, 'views')));
app.set('views', path.join(__dirname , 'views'));
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

// initialize the json parser
app.use(bodyParser.json());


//connection middleware
function auth(req, res, next) {
	if (req?.session?.user) {
		return next();
	}
	else {
		return res.sendStatus(401);
	}
}

//routes
app.get('/', function(req, res) {
	if(req?.session?.user){
		res.redirect("/home");
	}
	else{
		res.redirect("/login");
	}
});

app.get('/login', function(req, res) {
	res.render(path.join(__dirname, 'views', 'login.html'));
});
app.get('/register', function(req, res) {
	res.render(path.join(__dirname, 'views', 'register.html'));
});
app.get('/home', auth, async (req, res) => {
	const resources = await Resource.find();
	res.render(path.join(__dirname, 'views', 'home.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, resources });
});

app.get('/calendar', auth, async function(req, res) {
	const reservations = await Reservation.find();
	res.render(path.join(__dirname, 'views', 'calendar.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, reservations});
});

app.get('/reservations', auth, async function(req, res) {
	const reservations = await Reservation.find({user : req.session.user.username});
	return res.render(path.join(__dirname, 'views','reservations.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, reservations});
});

app.get('/addReservation', auth, async function(req, res) {
	const resources = await Resource.find();
	res.render(path.join(__dirname, 'views', 'addReservation.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, resources});
});

app.get('/admin', auth, async function(req, res) {
	if(req.session.user.isAdmin){
		const resources = await Resource.find();
		res.render(path.join(__dirname, 'views', 'admin.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, resources});
	}
});


//API

// Verify connection and set the user to call the home page
app.post('/api/login', async (req, res) => {
	const { username, password } = req.body
	const user = await User.findOne({ username }).lean()
	if (!user) {
		return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "Incorrect username or password", redirect : "/login"});
	} else if (await bcrypt.compare(password, user.password)){
		req.session.user = {username : username, isAdmin : user.isAdmin};
		res.redirect("/home");
	}
	else {
		return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "Incorrect username or password", redirect : "/login"});
	}
});


// Deconnection
app.post('/logout', function(req, res) {

	req.session.destroy();
	res.redirect("/login");
});

// Limit the number of registration to not suffer from a DDoS attack or surcharge the database
const registerLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10000, // limit each IP to 100 requests per windowMs
	message: "Too many registration attempts. Please try again later."
});

app.use("/api/register", registerLimiter);

// Register a new user and add it to the database
app.post('/api/register', async (req, res) => {
	const { username, password: plainTextPassword } = req.body
	if (!username || typeof username !== 'string') {
		return res.json({ status: 'error', error: "Nom d'utilisateur invalide" });
	}

	if (!plainTextPassword || typeof plainTextPassword !== 'string') {
		return res.json({ status: 'error', error: 'Mot de passe invalide' });
	}

	if (plainTextPassword.length < 4) {
		return res.json({
			status: 'error',
			error: 'Le mot de passe doit contenir au moins 4 caractères'
		})
	}
	const duplicate = await User.findOne({username});
	if(duplicate){
		return res.json({ status: 'error', error: "Nom d'utilisateur indisponible" });
	}else{
		const password = await bcrypt.hash(plainTextPassword, 10);
		const user = new User({ username, password, isAdmin : false });
		await user.save();
		req.session.user = {username : username, isAdmin : false};
		res.json({ status: 'ok' });
	}
});

// make a reservation and add it to the database
app.post('/api/reservations', auth, async (req, res) => {
	try {
		const {resourceId, dateDebut, dateFin, user} = req.body;
		let conflicts = [];
        if (dateDebut > dateFin) {
            return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "La date de début doit être antérieure à la date de fin", redirect : "/addReservation"});
        }

		// check for conflicts with existing reservations
		for (let i = 0; i < resourceId.length; i++) {
			const existingReservation = await Reservation.findOne({
				resourceId: resourceId[i],
				$or: [
					{$and: [{dateDebut: {$gte: dateDebut}}, {dateDebut: {$lte: dateFin}}]},
					{$and: [{dateFin: {$gte: dateDebut}}, {dateFin: {$lte: dateFin}}]},
					{$and: [{dateDebut: {$lte: dateDebut}}, {dateFin: {$gte: dateFin}}]}
				]
			});
			if (existingReservation) {
				conflicts.push(resourceId[i]);
			}
		}
		if (conflicts.length > 0) {
			const error = {
				status: 'Conflit de réservation',
				message: `Votre réservation n'a pas pu aboutir car une autre réservation est déjà en cours pour la(les) ressource(s) : "${conflicts}" durant cette plage horaire.`
			};
			return res.render(path.join(__dirname, 'views', 'conflict.ejs'), {error});

		}
	// create new reservation

		for (let i = 0; i < resourceId.length; i++) {
			const reservation = new Reservation({
				resourceId: resourceId[i],
				dateDebut,
				dateFin,
				user
			});
			await reservation.save();
			const resource = await Resource.findOne({ name: resourceId[i] });
			await resource.save();
		}
	} catch (error) {
		return res.render(path.join(__dirname, 'views','error.ejs'),
			{error : "La création de la réservation a échoué. Veuillez réessayer ultérieurement.", redirect: "/reservations"});
	}


	return res.redirect("/reservations");
});

// delete a reservation
app.post('/api/reservations/delete', auth, async (req, res) => {
	try {
		const deletedReservation = await Reservation.findByIdAndDelete(req.body.id);
		if (!deletedReservation) {
			return res.status(404).render(path.join(__dirname, 'views', 'error.ejs'), {error : "Réservation introuvable", redirect: "/reservations"});
		}
		return res.redirect("/reservations");
	} catch (err) {
		return res.status(500).render(path.join(__dirname, 'views', 'error.ejs'),
			{error : "Erreur lors de la suppression de la réservation", redirect: "/reservations"});
	}
});

// create a new resource and add it to the database
app.post('/api/resources', auth, async (req, res) => {
	try {
		const duplicate = await Resource.findOne({
			name: req.body.name
		});
		if (duplicate) {
			return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "Ressource déjà existante", redirect: "/admin"});
		}
		const name = req.body.name;
		const resource = new Resource({name});
		await resource.save();
		return res.redirect("/admin");
	} catch (error) {
		return res.render(path.join(__dirname, 'views', 'error.ejs'),
			{error : "La création de la ressource a échoué. Veuillez réessayer ultérieurement.", redirect: "/admin"});
	}
});


app.listen(process.env.PORT, () => {
	debug("HTTP server listening");
})
