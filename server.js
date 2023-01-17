const express = require('express');
const path = require('path');
let bodyParser = require('body-parser');
const mongoose = require('mongoose');
const User = require('./model/user');
const bcrypt = require('bcryptjs');
const session = require("express-session");
const Reservation = require('./model/reservation');


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
app.get('/home', auth, function(req, res) {
	res.render(path.join(__dirname, 'views', 'home.html'), {user: req.session.user.username});
});

app.get('/reservations', auth, async function(req, res) {
	const reservations = await Reservation.find();
	return res.render(path.join(__dirname, 'views','reservations.ejs'), {user: req.session.user.username, reservations });
});

app.get('/addReservation', auth, function(req, res) {

	res.render(path.join(__dirname, 'views', 'addReservation.html'), {user: req.session.user.username});
});


app.post('/api/login', async (req, res) => {
	const { username, password } = req.body
	const user = await User.findOne({ username }).lean()
	if (!user) {
		return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "Incorrect username or password", redirect : "/login"});
	} else if (await bcrypt.compare(password, user.password)){
		req.session.user = {username : username};
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
		const {resourceId, dateDebut, dateFin} = req.body;
		let conflicts = [];

		// check for conflicts with existing reservations
		for(let i = 0; i < resourceId.length; i++) {
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
			return res.render(path.join(__dirname, 'views','conflict.ejs'), {error});

		}

	// create new reservation

		for (let i = 0; i < resourceId.length; i++) {
			const reservation = new Reservation({
				resourceId: resourceId[i],
				dateDebut,
				dateFin
			});
			await reservation.save();
		}
	} catch (error) {
		return res.render(path.join(__dirname, 'views','error.ejs'),
			{error : "La création de la réservation a échoué. Veuillez réessayer ultérieurement.", redirect: "/reservations"});
		console.log(error);
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


app.listen(3000, () => {
	console.log('Server up at 3000');
})
