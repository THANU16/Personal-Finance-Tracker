import { redirect } from "next/navigation";

// History is a tab of /sip (docs/05 §6).
export default function SipHistoryPage() {
  redirect("/sip?tab=history");
}
