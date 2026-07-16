// Extends app.json. On EAS Build, GOOGLE_SERVICES_JSON is a file-type env var
// whose value is the path to the uploaded file on the runner; locally it is unset
// and the gitignored copy in the project root is used instead.
export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
