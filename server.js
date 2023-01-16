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

app.get('/reservations', auth, function(req, res) {
	res.render(path.join(__dirname, 'views', 'reservations.html'), {user: req.session.user.username});
});

app.get('/addReservation', auth, function(req, res) {
	res.render(path.join(__dirname, 'views', 'addReservation.html'), {user: req.session.user.username});
});


app.post('/api/login', async (req, res) => {
	const { username, password } = req.body
	const user = await User.findOne({ username }).lean()
	if (!user) {
		return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "Incorrect username or password"});
	} else if (await bcrypt.compare(password, user.password)){
		req.session.user = {username : username};
		res.redirect("/home");
	}
	else {
		return res.render(path.join(__dirname, 'views', 'error.ejs'), {error : "Incorrect username or password"});
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
	const {resourceId, dateDebut, dateFin} = req.body;

	// check for conflicts with existing reservations
	const existingReservation = await Reservation.findOne(
		{ resourceId, dateDebut: { $lte: dateFin }, dateFin: { $gte: dateDebut } });
	if (existingReservation) {
		return res.json({ status: 'error', error: 'Conflict with existing reservation' });
	}

	// create new reservation
	const reservation = new Reservation({resourceId, description, dateDebut, dateFin});
	await reservation.save();

	return res.json({ status: 'success', reservation });
});



// get all reservations
app.get('/api/reservations', auth, async (req, res) => {
	const reservations = await Reservation.find();
	return res.json({ status: 'success', reservations });
});


app.listen(3000, () => {
	console.log('Server up at 3000');
})
