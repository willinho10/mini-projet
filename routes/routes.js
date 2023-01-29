const express = require('express');
const path = require('path');
const Resource = require('../model/resource');
const Reservation = require('../model/reservation');
const auth = require('../auth.js');
const router = express.Router();

//routes
router.get('/', function(req, res) {
    if(req?.session?.user){
        res.redirect("/home");
    }
    else{
        res.redirect("/login");
    }
});

router.get('/login', function(req, res) {
    res.render(path.join(__dirname, '../views', 'login.html'));
});
router.get('/register', function(req, res) {
    res.render(path.join(__dirname, '../views', 'register.html'));
});
router.get('/home', auth, async (req, res) => {
    const resources = await Resource.find();
    res.render(path.join(__dirname, '../views', 'home.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, resources });
});

router.get('/calendar', auth, async function(req, res) {
    const reservations = await Reservation.find();
    res.render(path.join(__dirname, '../views', 'calendar.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, reservations});
});

router.get('/reservations', auth, async function(req, res) {
    const reservations = await Reservation.find({user : req.session.user.username});
    return res.render(path.join(__dirname, '../views','reservations.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, reservations});
});

router.get('/addReservation', auth, async function(req, res) {
    const resources = await Resource.find();
    res.render(path.join(__dirname, '../views', 'addReservation.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, resources});
});

router.get('/admin', auth, async function(req, res) {
    if(req.session.user.isAdmin){
        const resources = await Resource.find();
        res.render(path.join(__dirname, '../views', 'admin.ejs'), {user: req.session.user.username, isAdmin: req.session.user.isAdmin, resources});
    }
});

module.exports = router;