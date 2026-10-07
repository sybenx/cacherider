package com.cacherider.android;

import android.widget.ImageView;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The launcher, as android-browser-helper's own, its splash (drawable-*dpi/splash.png, from android/splash/splash.svg)
 * said outright: centred at its own size, 300 dp, on the splash colour. Nothing cropped on a tall phone or one on its
 * side; the speed lines and the road fade out before the edges. (1.1.5 filled the screen with a taller design,
 * cropped to fit.) The launcher's old name stays the icon's and the shortcuts' (an alias in the manifest), so an
 * update keeps home-screen icons where they are.
 */
public class SplashLauncher extends LauncherActivity {
  @Override
  protected ImageView.ScaleType getSplashImageScaleType() {
    return ImageView.ScaleType.CENTER;
  }
}
