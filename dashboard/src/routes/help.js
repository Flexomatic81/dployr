const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// Hilfe-Hauptseite
router.get('/', requireAuth, (req, res) => {
    res.render('help/index', {
        title: 'Hilfe',
        activeSection: req.query.section || 'getting-started'
    });
});

module.exports = router;
