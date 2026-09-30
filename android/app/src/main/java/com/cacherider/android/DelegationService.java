package com.cacherider.android;

import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;

/**
 * The browser's way to this app, while the site runs in it as a Trusted Web Activity: its requests for the rider's
 * location come here, and are answered with this app's own location permission (Android asks the rider once). Without
 * it, a Chromium browser that routes a TWA's location through its app (Vanadium, on GrapheneOS) had nowhere to ask,
 * and the site never got a fix: no location icon at all, though a maps app found the phone in seconds.
 */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
  @Override
  public void onCreate() {
    super.onCreate();
    registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
  }
}
