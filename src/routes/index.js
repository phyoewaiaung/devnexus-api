// routes/index.js (or wherever you register routes)
const express = require('express');
const router = express.Router();

const auth = require('../middleware/authenticate');

const searchController = require('../controllers/searchController');

router.get('/search/suggest', auth, searchController.suggest);
router.get('/search', auth, searchController.search);

module.exports = router;
