const config = {
  appId: "id.co.jadicuan.kasirkonter",
  appName: "Kasir Konter",
  webDir: "dist",
  // Warna WebView sebelum halaman dimuat: navy, sama dengan splash (tanpa kilatan putih).
  backgroundColor: "#1f3a5f",
  server: {
    androidScheme: "https",
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
