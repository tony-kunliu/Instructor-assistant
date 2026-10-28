import { currentAppMode } from "@/lib/app-mode.ts";
import DriverApp from "./driver-app.tsx";

export const dynamic = "force-dynamic";

export default function Home() {
  // The SaaS edition is told its mode on the server, so its first paint already has its own header (no private-edition flash).
  return currentAppMode() === "saas" ? <DriverApp mode="saas" /> : <DriverApp />;
}
