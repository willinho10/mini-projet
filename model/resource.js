const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    available: {
        type: Boolean,
        default: true
    }
});

const Resource = mongoose.model('Resource', resourceSchema);

module.exports = Resource;
