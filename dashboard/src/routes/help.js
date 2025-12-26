const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// Help main page
router.get('/', requireAuth, (req, res) => {
    res.render('help/index', {
        title: 'Help',
        activeSection: req.query.section || 'getting-started'
    });
});

module.exports = router;
