export class PrivacyActionError extends Error {}
export class SessionProfileMismatchError extends Error {
  constructor() {
    super(
      "Saved broadcast consent does not match config.yaml privacy settings. Restore the previous profile, end that broadcast, then apply the new profile.",
    );
  }
}
