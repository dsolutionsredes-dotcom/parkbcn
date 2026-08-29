import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "ParkBCN",
  description: "Asistente personal de aparcamiento para Barcelona metropolitana",
  manifest: "/manifest.webmanifest",
  themeColor: "#0b1320"
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
