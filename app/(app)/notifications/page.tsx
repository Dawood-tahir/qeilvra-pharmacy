import Link from "next/link";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { safeAppPath } from "@/lib/navigation";

export default async function NotificationsPage() {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("notifications").select("id,title,message,severity,action_url,read_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Notifications could not be loaded. Please try again.");
  return <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Activity centre</p><h1 className="mt-1 text-2xl font-extrabold">Notifications</h1><p className="mt-1 text-sm text-slate-500">Open a notification to view its details and next action.</p><Card className="mt-5"><CardContent className="p-0">{!data?.length ? <EmptyState icon={Bell} title="No notifications" description="Important stock and workflow notifications will appear here." /> : <div className="divide-y divide-slate-100">{data.map((item) => { const content = <div className="flex gap-3 p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Bell className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong>{item.title}</strong>{!item.read_at && <Badge>New</Badge>}</span><span className="mt-1 block text-sm text-slate-600">{item.message}</span><span className="mt-1 block text-xs text-slate-400">{formatDateTime(item.created_at)}</span></span></div>; return item.action_url ? <Link key={item.id} href={safeAppPath(item.action_url)}>{content}</Link> : <div key={item.id}>{content}</div>; })}</div>}</CardContent></Card></main>;
}
