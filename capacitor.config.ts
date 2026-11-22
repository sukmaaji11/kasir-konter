const config = {
  appId: "id.co.jadicuan.kasirkonter",
  appName: "Kasir Konter",
  webDir: "dist",
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
