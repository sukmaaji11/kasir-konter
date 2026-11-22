package id.co.jadicuan.kasirkonter;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    /** Batas aman: splash sistem tidak pernah tertahan lebih dari ini. */
    private static final long MAX_SPLASH_MS = 8000;
    /** Beri WebView waktu menggambar halaman pertama setelah halaman dimuat. */
    private static final long PAINT_DELAY_MS = 600;

    private volatile boolean webReady = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Splash sistem (navy + logo) ditahan sampai halaman web selesai dimuat.
        // Halaman web langsung menampilkan logo yang sama di posisi yang sama,
        // jadi tidak ada layar navy kosong saat WebView sedang menyala.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(() -> !webReady);
        // Tutup langsung tanpa animasi pudar (splash web sudah menampilkan logo yang sama).
        splash.setOnExitAnimationListener(view -> view.remove());
        Handler main = new Handler(Looper.getMainLooper());
        main.postDelayed(() -> webReady = true, MAX_SPLASH_MS);

        registerPlugin(BluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    main.postDelayed(() -> webReady = true, PAINT_DELAY_MS);
                }
            });
        } else {
            webReady = true;
        }

        // Tombol Back Android: tutup lembar/dialog di aplikasi lebih dulu
        // (UI web memakai history.pushState), keluar aplikasi bila sudah di awal.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
