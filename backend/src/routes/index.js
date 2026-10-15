'use strict';

const { Router } = require('express');
const userRoutes = require('./userRoutes');
const projectRoutes = require('./projectRoutes');
const deploymentRoutes = require('./deploymentRoutes');
const incidentRoutes = require('./incidentRoutes');
const eventRoutes = require('./eventRoutes');
const dashboardRoutes = require('./dashboardRoutes');

/**
 * Protected API surface (mounted behind requireAuth in app.js).
 * Public routes (auth, health, webhooks) are mounted separately.
 */
const router = Router();

router.use('/users', userRoutes);
router.use('/projects', projectRoutes);
router.use('/deployments', deploymentRoutes);
router.use('/incidents', incidentRoutes);
router.use('/events', eventRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
