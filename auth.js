// middleware d'authentification

function auth(req, res, next) {
    if (req?.session?.user) {
        return next();
    }
    else {
        return res.sendStatus(401);
    }
}

module.exports = auth;
