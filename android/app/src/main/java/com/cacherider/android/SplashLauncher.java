package com.cacherider.android;

import android.widget.ImageView;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The launcher, as android-browser-helper's own, with one change: the splash (drawable-*dpi/splash.png, from
 * android/splash/splash.svg) fills the screen rather than sitting centred at its own size. Its speed lines and road
 * run off the sides, so it's cropped to the screen: a little off the sides on a tall phone, the top and bottom on a
 * wide one; the bus is in the middle either way. The launcher's old name stays the icon's and the shortcuts' (an
 * alias in the manifest), so an update keeps home-screen icons where they are.
 */
public class SplashLauncher extends LauncherActivity {
  @Override
  protected ImageView.ScaleType getSplashImageScaleType() {
    return ImageView.ScaleType.CENTER_CROP;
  }
}
