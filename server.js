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



mongoose.connect('mongodb://localhost:27017/login-app-db', {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useCreateIndex: true
});

const app = express();

app.use(session({
	secret: 'top secret',
	resave: true,
	saveUninitialized: true
}));

// middleware d'authentification
function auth(req, res, next) {
	if (req?.session?.user) {
		return next();
	}
	else {
		return res.sendStatus(401);
	}
}

app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(express.static(path.join(__dirname, 'views')));
app.set('views', path.join(__dirname , 'views'));
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(bodyParser.json());

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
	const reservations = await Reservation.find({});
	const availableResources = await Resource.find({ available: true });
	res.render(path.join(__dirname, 'views', 'home.ejs'), {user: req.session.user.username, reservations, availableResources });
});

app.get('/calendar', auth, async function(req, res) {
	const reservations = await Reservation.find();
	res.render(path.join(__dirname, 'views', 'calendar.ejs'), {user: req.session.user.username, reservations});
});

app.get('/reservations', auth, async function(req, res) {
	const reservations = await Reservation.find({user : req.session.user.username});
	return res.render(path.join(__dirname, 'views','reservations.ejs'), {user: req.session.user.username, reservations});
});

app.get('/addReservation', auth, async function(req, res) {
	const resources = await Resource.find();
	res.render(path.join(__dirname, 'views', 'addReservation.ejs'), {user: req.session.user.username, resources});
});

app.get('/admin', auth, function(req, res) {
	if(req.session.user.isAdmin){
		const resources = Resource.find();
		res.render(path.join(__dirname, 'views', 'admin.ejs'), {user: req.session.user.username, resources});
	}else{
		res.redirect("/home");
	}
});



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



app.post('/logout', function(req, res) {

	req.session.destroy();
	res.redirect("/login");
});

const registerLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10000, // limit each IP to 100 requests per windowMs
	message: "Too many registration attempts. Please try again later."
});

app.use("/api/register", registerLimiter);

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
			error: 'Le mot de passe doit contenir au moins 5 caractères'
		})
	}

	const password = await bcrypt.hash(plainTextPassword, 10);

	try {
		const response = await User.create({
			username,
			password
		});
		console.log('Utilisateur créé : ', response);
	} catch (error) {
		if (error.code === 11000) {
			// duplicate key
			return res.json({ status: 'error', error: "Nom d'utilisateur indisponible" });
		}
		throw error
	}

	res.json({ status: 'ok' });
})

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
			const resource = await Resource.findOne({ _id: resourceId[i] });
			resource.available = false;
			await resource.save();
		}
	} catch (error) {
		return res.render(path.join(__dirname, 'views','error.ejs'),
			{error : "La création de la réservation a échoué. Veuillez réessayer ultérieurement.", redirect: "/reservations"});
	}


	return res.redirect("/reservations");
});

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

app.post('/api/resources', auth, async (req, res) => {
	try {
		const name = req.body;
		const resource = new Resource({
			name,
			available: true
		});
		await resource.save();
		return res.redirect("/admin");
	} catch (error) {
		return res.render(path.join(__dirname, 'views', 'error.ejs'),
			{error : "La création de la ressource a échoué. Veuillez réessayer ultérieurement.", redirect: "/admin"});
	}
});


app.listen(3000, () => {
	console.log('Server up at 3000');
})
