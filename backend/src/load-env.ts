import dotenv from 'dotenv';

/** Loads .env (if present) without dotenv's console banner. Imported first by every entry point. */
dotenv.config({ quiet: true });
