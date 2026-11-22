package id.co.jadicuan.kasirkonter;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Cetak ESC/POS ke printer thermal Bluetooth klasik (SPP) yang sudah
 * dipasangkan di pengaturan Bluetooth HP. Tidak memindai perangkat baru,
 * jadi cukup izin BLUETOOTH_CONNECT (Android 12+).
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = BluetoothPrinterPlugin.PERMISSION_ALIAS)
    }
)
public class BluetoothPrinterPlugin extends Plugin {

    static final String PERMISSION_ALIAS = "bluetooth";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CHUNK_SIZE = 512;

    /** Satu antrean: dua struk tidak pernah dikirim bersamaan. */
    private final ExecutorService printQueue = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias(PERMISSION_ALIAS, call, "permissionCallback");
            return;
        }
        doListPairedDevices(call);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias(PERMISSION_ALIAS, call, "permissionCallback");
            return;
        }
        doPrint(call);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (needsPermission()) {
            call.reject(
                "Izin Perangkat sekitar (Bluetooth) ditolak. Izinkan di Pengaturan HP → Aplikasi → Kasir Konter → Izin.",
                "PERMISSION_DENIED"
            );
            return;
        }
        if ("print".equals(call.getMethodName())) {
            doPrint(call);
        } else {
            doListPairedDevices(call);
        }
    }

    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState(PERMISSION_ALIAS) != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = getContext().getSystemService(BluetoothManager.class);
        return manager == null ? null : manager.getAdapter();
    }

    @SuppressWarnings("MissingPermission")
    private void doListPairedDevices(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject result = new JSObject();
        JSArray devices = new JSArray();
        if (adapter == null) {
            result.put("available", false);
            result.put("enabled", false);
            result.put("devices", devices);
            call.resolve(result);
            return;
        }
        boolean enabled = adapter.isEnabled();
        result.put("available", true);
        result.put("enabled", enabled);
        if (enabled) {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            List<JSObject> printers = new ArrayList<>();
            List<JSObject> others = new ArrayList<>();
            if (bonded != null) {
                for (BluetoothDevice device : bonded) {
                    JSObject item = new JSObject();
                    String name = device.getName();
                    item.put("name", name == null || name.isEmpty() ? device.getAddress() : name);
                    item.put("address", device.getAddress());
                    boolean printerLike = isPrinterLike(device, name);
                    item.put("looksLikePrinter", printerLike);
                    (printerLike ? printers : others).add(item);
                }
            }
            for (JSObject item : printers) devices.put(item);
            for (JSObject item : others) devices.put(item);
        }
        result.put("devices", devices);
        call.resolve(result);
    }

    @SuppressWarnings("MissingPermission")
    private static boolean isPrinterLike(BluetoothDevice device, String name) {
        BluetoothClass bluetoothClass = device.getBluetoothClass();
        if (bluetoothClass != null && bluetoothClass.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING) {
            return true;
        }
        if (name == null) return false;
        String lower = name.toLowerCase();
        return lower.contains("print") || lower.contains("pos") || lower.contains("rpp")
            || lower.contains("mpt") || lower.contains("thermal");
    }

    private void doPrint(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("Data cetak tidak lengkap.");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("Data cetak rusak.");
            return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("HP ini tidak punya Bluetooth.", "NO_BLUETOOTH");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth mati. Nyalakan Bluetooth lalu coba cetak lagi.", "BLUETOOTH_OFF");
            return;
        }
        printQueue.execute(() -> sendToPrinter(call, adapter, address, bytes));
    }

    @SuppressWarnings("MissingPermission")
    private void sendToPrinter(PluginCall call, BluetoothAdapter adapter, String address, byte[] bytes) {
        BluetoothSocket socket = null;
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            adapter.cancelDiscovery();
            socket = connect(device);
            OutputStream output = socket.getOutputStream();
            for (int offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
                int length = Math.min(CHUNK_SIZE, bytes.length - offset);
                output.write(bytes, offset, length);
                output.flush();
            }
            // Beri waktu printer mengosongkan buffer sebelum koneksi ditutup;
            // banyak printer murah memotong struk bila koneksi diputus terlalu cepat.
            Thread.sleep(Math.min(2500, 400 + bytes.length / 3));
            call.resolve();
        } catch (IllegalArgumentException error) {
            call.reject("Alamat printer tidak valid. Pilih ulang printer di Pengaturan.", "BAD_ADDRESS");
        } catch (IOException error) {
            call.reject(
                "Printer tidak terhubung. Pastikan printer menyala, dekat dengan HP, dan tidak sedang dipakai HP lain.",
                "CONNECT_FAILED"
            );
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            call.reject("Pencetakan terhenti.");
        } catch (SecurityException error) {
            call.reject("Izin Bluetooth belum diberikan.", "PERMISSION_DENIED");
        } finally {
            if (socket != null) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // Sudah selesai mencetak; gagal menutup tidak perlu dilaporkan.
                }
            }
        }
    }

    @SuppressWarnings("MissingPermission")
    private static BluetoothSocket connect(BluetoothDevice device) throws IOException {
        BluetoothSocket secure = device.createRfcommSocketToServiceRecord(SPP_UUID);
        try {
            secure.connect();
            return secure;
        } catch (IOException firstError) {
            try {
                secure.close();
            } catch (IOException ignored) {
                // abaikan
            }
            // Sebagian printer murah hanya menerima koneksi tanpa enkripsi.
            BluetoothSocket insecure = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            try {
                insecure.connect();
                return insecure;
            } catch (IOException secondError) {
                try {
                    insecure.close();
                } catch (IOException ignored) {
                    // abaikan
                }
                throw secondError;
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        printQueue.shutdownNow();
        super.handleOnDestroy();
    }
}
