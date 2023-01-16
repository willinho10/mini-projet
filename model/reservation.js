const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
    ressourceId: {
        type: String,
        required: true,
        unique: true
    },
    dateDebut: {
        type: Date,
        required: true
    },
    dateFin: {
        type: Date,
        required: true
    }
});

const Reservation = mongoose.model('Reservation', reservationSchema);

module.exports = Reservation;
