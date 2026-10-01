import { useState, type FormEvent } from "react";
import { AppEntry, SiteEntry, describeZodError, type Policy } from "@asd/shared";
import { api } from "../api";
import { t } from "../strings";

// Allow-list editor. Entries are checked with the SAME zod schemas the server and agents use,
// so the UI shows exactly the error the server would give.
// App.tsx gives this component key={policy.version}: when a new version is saved,
// React re-creates it, so the edit fields start from the saved policy again.

type Props = { readonly policy: Policy };

export function PolicyPage({ policy }: Props) {
  const [apps, setApps] = useState(policy.apps);
  const [sites, setSites] = useState(policy.sites);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = apps !== policy.apps || sites !== policy.sites;

  const save = async () => {
    const result = await api.savePolicy({ apps, sites });
    if (!result.ok) return setMessage(t.errorPrefix + result.error);
    setApps(result.value.apps);
    setSites(result.value.sites);
    setMessage(t.policy.saved(result.value.version));
  };

  return (
    <section>
      <p className="muted">{t.policy.version(policy.version)}</p>
      <h2>{t.policy.apps}</h2>
      <ul className="entries">
        {apps.map((app) => (
          <li key={app.id}>
            <strong>{app.name}</strong> <code>{app.exePath}</code>
            {app.folderPath !== undefined && <span className="muted"> + {app.folderPath}</span>}
            <button className="link danger" onClick={() => setApps(apps.filter((a) => a.id !== app.id))}>{t.policy.remove}</button>
          </li>
        ))}
      </ul>
      <AddAppForm onAdd={(app) => setApps([...apps, app])} existing={apps.map((a) => a.id)} />

      <h2>{t.policy.sites}</h2>
      <ul className="entries">
        {sites.map((site) => (
          <li key={site.id}>
            <strong>{site.name}</strong> <code>{site.pattern}</code>
            <button className="link danger" onClick={() => setSites(sites.filter((s) => s.id !== site.id))}>{t.policy.remove}</button>
          </li>
        ))}
      </ul>
      <AddSiteForm onAdd={(site) => setSites([...sites, site])} existing={sites.map((s) => s.id)} />

      <div className="savebar">
        {dirty && <span className="pending">{t.policy.unsaved}</span>}
        <button className="primary" disabled={!dirty} onClick={() => void save()}>{t.policy.save}</button>
        {message !== null && <span className="notice">{message}</span>}
      </div>
    </section>
  );
}

type AddProps<T> = { readonly onAdd: (entry: T) => void; readonly existing: readonly string[] };

function AddAppForm({ onAdd, existing }: AddProps<AppEntry>) {
  const [fields, setFields] = useState({ id: "", name: "", exePath: "", folderPath: "", args: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const args = fields.args.split("\n").map((a) => a.trim()).filter((a) => a !== "");
    const parsed = AppEntry.safeParse({
      id: fields.id.trim(),
      name: fields.name,
      exePath: fields.exePath.trim(),
      ...(fields.folderPath.trim() === "" ? {} : { folderPath: fields.folderPath.trim() }),
      ...(args.length === 0 ? {} : { args }),
    });
    if (!parsed.success) return setError(describeZodError(parsed.error));
    if (existing.includes(parsed.data.id)) return setError(`id "${parsed.data.id}" is already used`);
    onAdd(parsed.data);
    setFields({ id: "", name: "", exePath: "", folderPath: "", args: "" });
    setError(null);
  };
  const field = (key: keyof typeof fields, label: string) => (
    <label>{label}<input value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></label>
  );
  return (
    <form className="addform" onSubmit={submit}>
      {field("id", t.policy.id)}
      {field("name", t.policy.name)}
      {field("exePath", t.policy.exePath)}
      {field("folderPath", t.policy.folderPath)}
      <label>{t.policy.args}<textarea rows={2} value={fields.args} onChange={(e) => setFields({ ...fields, args: e.target.value })} /></label>
      <button type="submit">{t.policy.add}</button>
      {error !== null && <span className="error">{error}</span>}
    </form>
  );
}

function AddSiteForm({ onAdd, existing }: AddProps<SiteEntry>) {
  const [fields, setFields] = useState({ id: "", name: "", pattern: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = SiteEntry.safeParse({ id: fields.id.trim(), name: fields.name, pattern: fields.pattern });
    if (!parsed.success) return setError(describeZodError(parsed.error));
    if (existing.includes(parsed.data.id)) return setError(`id "${parsed.data.id}" is already used`);
    onAdd(parsed.data);
    setFields({ id: "", name: "", pattern: "" });
    setError(null);
  };
  return (
    <form className="addform" onSubmit={submit}>
      <label>{t.policy.id}<input value={fields.id} onChange={(e) => setFields({ ...fields, id: e.target.value })} /></label>
      <label>{t.policy.name}<input value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} /></label>
      <label>{t.policy.pattern}<input value={fields.pattern} onChange={(e) => setFields({ ...fields, pattern: e.target.value })} /></label>
      <button type="submit">{t.policy.add}</button>
      {error !== null && <span className="error">{error}</span>}
    </form>
  );
}
