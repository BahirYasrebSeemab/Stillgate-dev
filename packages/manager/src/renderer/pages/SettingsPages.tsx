import { useState, type FormEvent } from "react";
import { checkNewPassword } from "@stillgate/shared";
import type { EventView, PairingOffer, Snapshot } from "../../common/api";
import { api, formatTime } from "../api";
import { t } from "../strings";

export function PasswordPage({ snapshot }: { readonly snapshot: Snapshot }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local = checkNewPassword(password, confirmation);
    if (!local.ok) return setMessage(t.errorPrefix + local.error);
    const result = await api.setPassword(password, confirmation);
    setMessage(result.ok ? t.password.saved : t.errorPrefix + result.error);
    if (result.ok) {
      setPassword("");
      setConfirmation("");
    }
  };

  return (
    <section>
      <p>{t.password.intro}</p>
      <p className={snapshot.password.set ? "ok" : "pending"}>
        {snapshot.password.set ? t.password.isSet(snapshot.password.version) : t.password.notSet}
      </p>
      <form className="addform narrow" onSubmit={(e) => void submit(e)}>
        <label>{t.password.newPassword}<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>{t.password.confirm}<input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <button type="submit" className="primary">{t.password.save}</button>
      </form>
      {message !== null && <p className="notice">{message}</p>}
    </section>
  );
}

export function PairingPage({ snapshot }: { readonly snapshot: Snapshot }) {
  const addresses = snapshot.server.addresses;
  const [address, setAddress] = useState(addresses[0] ?? "");
  const [offer, setOffer] = useState<PairingOffer | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const create = async () => {
    const result = await api.createPairing(address);
    if (!result.ok) return setMessage(t.errorPrefix + result.error);
    setOffer(result.value);
    setMessage(null);
  };
  const copy = async () => {
    if (offer === null) return;
    await api.copyText(offer.pairingString);
    setMessage(t.pairing.copied);
  };

  if (!snapshot.password.set) return <p className="pending">{t.pairing.needPassword}</p>;
  return (
    <section>
      <p>{t.pairing.intro}</p>
      <pre>{t.pairing.command}</pre>
      <label className="inline">
        {t.pairing.address}{" "}
        <select value={address} onChange={(e) => setAddress(e.target.value)}>
          {addresses.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <button className="primary" onClick={() => void create()}>{t.pairing.create}</button>
      {offer !== null && (
        <div className="pairing">
          <code>{offer.pairingString}</code>
          <button onClick={() => void copy()}>{t.pairing.copy}</button>
          <p className="muted">{t.pairing.expires(new Date(offer.expiresAt).toLocaleTimeString())}</p>
        </div>
      )}
      {message !== null && <p className="notice">{message}</p>}
    </section>
  );
}

export function EventsPage({ events }: { readonly events: readonly EventView[] }) {
  if (events.length === 0) return <p className="empty">{t.events.empty}</p>;
  return (
    <table>
      <thead>
        <tr><th>{t.events.time}</th><th>{t.events.computer}</th><th>{t.events.kind}</th><th>{t.events.detail}</th></tr>
      </thead>
      <tbody>
        {events.map((event, index) => (
          <tr key={`${event.at}-${index}`}>
            <td className="small">{formatTime(event.at, "")}</td>
            <td>{event.machineName ?? "—"}</td>
            <td><span className="tag">{event.kind}</span></td>
            <td>{event.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
