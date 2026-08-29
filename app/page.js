"use client";

import dynamic from "next/dynamic";

const ParkingMap = dynamic(() => import("@/components/ParkingMap"), {
  ssr: false,
  loading: () => (
    <main className="loadingScreen">
      <div className="brandMark">P</div>
      <strong>Cargando ParkBCN…</strong>
    </main>
  )
});

export default function Home() {
  return <ParkingMap />;
}
