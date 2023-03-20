const router = module.exports = require('express').Router();

router.use('/', require('./home'));
router.use('/users', require('./users'));
router.use('/boats', require('./boats'));
router.use('/loads', require('./loads'));