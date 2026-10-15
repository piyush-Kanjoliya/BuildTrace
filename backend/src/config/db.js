'use strict';

const mongoose = require('mongoose');
const logger = require('./logger');
const env = require('./env');

mongoose.set('strictQuery', true);

/**
 * Connect to MongoDB with clear error handling.
 * The process exits only in production; in dev/test the error is surfaced.
 */
async function connectDatabase(uri = env.mongodbUri) {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20,
    });
    logger.info({ uri: uri.replace(/\/\/.*@/, '//***@') }, 'MongoDB connected');
    return mongoose.connection;
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed');
    if (env.isProd) process.exit(1);
    throw err;
  }
}

async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectDatabase, disconnectDatabase, isDbConnected, mongoose };
