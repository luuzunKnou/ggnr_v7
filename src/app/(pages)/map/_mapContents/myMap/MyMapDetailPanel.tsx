'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2, X } from 'lucide-react';
import { call } from '@/lib/api';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';

type FieldRow = {
  defineFieldName: string;
  defineFieldKorName: string;
  defineFieldIsKey: boolean;
  defineFieldShowList: boolean;
};

type Props = {
  tableName: string;
  onClose: () => void;
  onChanged: () => void;
};

export function MyMapDetailPanel({ tableName, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layerName, setLayerName] = useState('');
  const [layerGroup, setLayerGroup] = useState('');
  const [fields, setFields] = useState<FieldRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void call('', 'POST', {
      service: 'myMapService',
      action: 'getMyLayer',
      params: { tableName },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setLayerName(String(data?.layer?.layerName ?? ''));
        setLayerGroup(String(data?.layer?.layerGroup ?? ''));
        setFields(Array.isArray(data?.fields) ? data.fields : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tableName]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await call('', 'POST', {
        service: 'myMapService',
        action: 'updateMyLayer',
        params: { tableName, layerName, layerGroup, fields },
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('이 레이어를 삭제할까요?')) return;
    setSaving(true);
    try {
      await call('', 'POST', {
        service: 'myMapService',
        action: 'deleteMyLayer',
        params: { tableName },
      });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">레이어 상세</h2>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3 text-[12px]">
        {loading ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            {error && (
              <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive">{error}</p>
            )}
            <div>
              <div className="mb-1 text-[11px] font-medium">한글명</div>
              <Input className="h-8 text-[12px]" value={layerName} onChange={(e) => setLayerName(e.target.value)} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium">그룹명</div>
              <Input className="h-8 text-[12px]" value={layerGroup} onChange={(e) => setLayerGroup(e.target.value)} />
            </div>
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1.5 text-left">영문</th>
                    <th className="px-2 py-1.5 text-center">고유</th>
                    <th className="px-2 py-1.5 text-center">목록</th>
                    <th className="px-2 py-1.5 text-left">한글</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, idx) => (
                    <tr key={f.defineFieldName} className="border-t border-border/60">
                      <td className="px-2 py-1 font-mono">{f.defineFieldName}</td>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="radio"
                          name="detailKey"
                          checked={!!f.defineFieldIsKey}
                          onChange={() =>
                            setFields((prev) =>
                              prev.map((row, i) => ({
                                ...row,
                                defineFieldIsKey: i === idx,
                              }))
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={!!f.defineFieldShowList}
                          onChange={(e) =>
                            setFields((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, defineFieldShowList: e.target.checked } : row
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          className="h-7 text-[11px]"
                          value={f.defineFieldKorName}
                          onChange={(e) =>
                            setFields((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, defineFieldKorName: e.target.value } : row
                              )
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button type="button" variant="destructive" size="sm" className="h-8 gap-1" onClick={() => void remove()} disabled={saving || loading}>
          <Trash2 className="h-3.5 w-3.5" />
          삭제
        </Button>
        <Button type="button" size="sm" className="h-8 gap-1" onClick={() => void save()} disabled={saving || loading}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          저장
        </Button>
      </div>
    </div>
  );
}
