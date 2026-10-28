import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Pencil, Plus, Search } from 'lucide-react';
import { AppShell } from './AppShell';
import { Button, Card, Empty, Eyebrow } from './ui';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import type { LostFoundInput, LostFoundItem, LostFoundList } from '@/lib/types';

const empty: LostFoundInput = { category: '', item: '', description: '', foundLocation: '', storageLocation: '' };
const fields: { key: keyof LostFoundInput; label: string; limit: number; placeholder: string }[] = [
  { key: 'category', label: 'Item category', limit: 80, placeholder: 'e.g. Electronics' },
  { key: 'item', label: 'Item', limit: 200, placeholder: 'e.g. Black wireless headphones' },
  { key: 'description', label: 'Description', limit: 4000, placeholder: 'Colour, brand and identifying details' },
  { key: 'foundLocation', label: 'Location found', limit: 200, placeholder: 'e.g. Room 203, bedside table' },
  { key: 'storageLocation', label: 'Place of storage', limit: 200, placeholder: 'e.g. Front Office cupboard, shelf B' },
];
const inputClass = 'mt-1.5 w-full rounded-[9px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-600';

export function LostFoundPage() {
  const user = useCurrentUser();
  return (
    <AppShell title="Lost & Found">
      {user && ['manager', 'front-office'].includes(user.role)
        ? <LostFoundRegister key={user.id} />
        : <p className="text-sm text-ink-3">Sign in as Manager or Front Office to view Lost &amp; Found.</p>}
    </AppShell>
  );
}

function LostFoundRegister() {
  const [data, setData] = useState<LostFoundList | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false), [editing, setEditing] = useState<LostFoundItem | null>(null);
  const [form, setForm] = useState<LostFoundInput>(empty), [saving, setSaving] = useState(false), [formError, setFormError] = useState('');
  const requestId = useRef(0);
  const formElement = useRef<HTMLFormElement>(null);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError('');
    try {
      const result = await api.getLostFound(query, page);
      if (!result) throw new Error('Unable to load Lost & Found. Please refresh.');
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : 'Unable to load Lost & Found.');
    } finally { if (id === requestId.current) setLoading(false); }
  }, [query, page]);

  useEffect(() => {
    setData(null); void load();
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    return () => { requestId.current++; window.removeEventListener('focus', refresh); };
  }, [load]);
  useEffect(() => {
    if (formOpen) {
      formElement.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      formElement.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, [formOpen, editing?.id]);

  const openForm = (record: LostFoundItem | null) => {
    setEditing(record);
    setForm(record ? { category: record.category, item: record.item, description: record.description, foundLocation: record.foundLocation, storageLocation: record.storageLocation } : { ...empty });
    setFormError(''); setNotice(''); setFormOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setFormError(''); setNotice('');
    try {
      const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as unknown as LostFoundInput;
      const result = editing ? await api.updateLostFound(editing.id, { ...values, version: editing.version }) : await api.createLostFound(values);
      if (!result) throw new Error('The save could not be confirmed. Refresh the list before trying again.');
      setFormOpen(false); setEditing(null); setForm({ ...empty });
      setNotice(editing ? 'Item updated.' : 'Item added to Lost & Found.');
      if (page !== 1 || query) { setPage(1); setQuery(''); setSearch(''); }
      else await load();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Unable to save this item.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Hotel register</Eyebrow>
          <h1 className="mt-1.5 font-display text-[27px] font-medium text-ink">Lost &amp; Found</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-3">Record found belongings and where they are stored. Shared with your hotel's Front Office and Manager.</p>
        </div>
        <Button icon={Plus} disabled={formOpen || saving} onClick={() => openForm(null)}>Add item</Button>
      </div>
      {notice && <p role="status" className="rounded-[9px] bg-pine-50 px-3 py-2 text-sm text-pine-700">{notice}</p>}
      {formOpen && <Card>
        <form ref={formElement} onSubmit={save} aria-label={editing ? 'Edit found item' : 'Add found item'}>
          <h2 className="mb-4 font-display text-xl text-ink">{editing ? 'Edit item' : 'Add found item'}</h2>
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            {fields.map(field => <label key={field.key} className={`text-[13px] font-medium text-ink-2${field.key === 'description' ? ' sm:col-span-2' : ''}`}>
              {field.label}
              {field.key === 'description'
                ? <textarea required rows={3} maxLength={field.limit} className={inputClass} value={form[field.key]} placeholder={field.placeholder} onChange={e => setForm(old => ({ ...old, [field.key]: e.target.value }))} />
                : <input required maxLength={field.limit} list={field.key === 'category' ? 'lost-found-categories' : undefined} className={inputClass} value={form[field.key]} placeholder={field.placeholder} onChange={e => setForm(old => ({ ...old, [field.key]: e.target.value }))} />}
            </label>)}
          </fieldset>
          <datalist id="lost-found-categories">{['Electronics', 'Clothing', 'Jewellery', 'Documents', 'Keys', 'Bags', 'Personal care', 'Other'].map(category => <option key={category} value={category} />)}</datalist>
          {formError && <p role="alert" className="mt-3 text-sm text-urgent">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save item'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => { setFormOpen(false); setEditing(null); setFormError(''); }}>Cancel</Button>
          </div>
        </form>
      </Card>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form role="search" className="flex w-full gap-2 sm:max-w-lg" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
          <input aria-label="Search lost and found" maxLength={200} className={`${inputClass} mt-0`} placeholder="Search items, descriptions or locations" value={search} onChange={e => setSearch(e.target.value)} />
          <Button type="submit" variant="outline" icon={Search}>Search</Button>
        </form>
        <Button variant="quiet" disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-urgent">{error} {data ? 'Displayed information may be out of date.' : ''}</p>}
      <Card pad={false}>
        {loading && !data ? <p role="status" className="p-5 text-sm text-ink-3">Loading found items…</p> : data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">Lost and found items for this hotel</caption>
              <thead className="border-b border-line bg-paper/60 text-[11px] tracking-wide text-ink-3 uppercase"><tr>
                {['Item category', 'Item', 'Description', 'Location found', 'Place of storage', 'Actions'].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
              </tr></thead>
              <tbody>{data.items.map(record => <tr key={record.id} className="border-b border-line-soft last:border-b-0">
                <td className="px-4 py-3 align-top text-ink-3">{record.category}</td>
                <th scope="row" className="min-w-36 px-4 py-3 align-top font-medium text-ink">{record.item}</th>
                <td className="min-w-52 max-w-sm whitespace-pre-wrap break-words px-4 py-3 align-top text-ink-3">{record.description}</td>
                <td className="min-w-36 whitespace-pre-wrap break-words px-4 py-3 align-top text-ink-3">{record.foundLocation}</td>
                <td className="min-w-36 whitespace-pre-wrap break-words px-4 py-3 align-top text-ink-3">{record.storageLocation}</td>
                <td className="px-4 py-3 align-top"><Button size="sm" variant="outline" icon={Pencil} disabled={formOpen || saving} onClick={() => openForm(record)}>Edit<span className="sr-only"> {record.item}</span></Button></td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : !error && !loading && <div className="p-5"><Empty icon={Archive} title={query ? 'No matching items' : 'No found items recorded'} hint={query ? 'Try a different item, description or location.' : 'Add an item to start your hotel’s Lost & Found register.'} /></div>}
      </Card>
      {data && <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-3">
        <p>{data.total} {data.total === 1 ? 'item' : 'items'}{query ? ' matching your search' : ' recorded'} · Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</p>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={loading || page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button></div>
      </div>}
    </div>
  );
}
