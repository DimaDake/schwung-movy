/* Stands in for a Schwung file the SCHWUNG checkout does not have — the
 * import fails exactly as it would on a device running an older Schwung, so
 * the caller's fallback is what the suite exercises (build/browser.mjs). */
throw new Error('schwung-missing: this Schwung checkout does not serve the imported file');
