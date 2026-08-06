import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  ArchiveRestore,
  Bug,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  ExternalLink,
  Globe2,
  Gauge,
  Home,
  KeyRound,
  Loader2,
  MoreVertical,
  Network,
  PanelTop,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  Route,
  Save,
  Send,
  Settings,
  Shield,
  TerminalSquare,
  Trash2,
  Wrench,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib";
import "./styles.css";

type ProxyMode = "rule" | "global" | "direct";

type Status = {
  services: { singBox: string; kernel?: string; kernelStatus?: string; forwardTimer: string; admin: string };
  addresses: { admin: string; adminZeroTier: string; panel: string; proxy: string };
  ports: { admin: string; panel: string; proxy: string };
  tunEnabled: boolean;
  proxyMode: ProxyMode;
  kernel?: "sing-box" | "mihomo";
  nodeCount: number;
  subscriptionCount: number;
};

type SubscriptionUserInfo = { upload?: number; download?: number; total?: number; expire?: number };
type Subscription = { id: string; name: string; url: string; enabled: boolean; userinfo?: SubscriptionUserInfo };
type ActionResult = { ok: boolean; output?: string; error?: string; message?: string };
type ClashProxy = { type: string; name?: string; now?: string; all?: string[]; udp?: boolean; history?: Array<{ time: string; delay: number }> };
type ClashConnection = {
  id: string;
  metadata?: { host?: string; sourceIP?: string; sourcePort?: string | number; destinationIP?: string; destinationPort?: string | number; network?: string; type?: string };
  upload?: number;
  download?: number;
  chains?: string[];
  rule?: string;
};
type BasicSettings = Record<"LAN_IF" | "LAN_NET" | "LAN_IP" | "PROXY_PORT" | "PANEL_PORT" | "ADMIN_PORT" | "TUN_ENABLE" | "DNS1" | "DNS2" | "SUBSCRIBE_USER_AGENT" | "DOWNLOAD_PROXY", string>;
type NetworkInterface = { name: string; address: string; cidr: string; network: string };
type CustomRules = { directDomains: string[]; directIps: string[]; proxyDomains: string[]; proxyIps: string[] };
type SyncSettings = {
  provider: string;
  webdavUrl: string;
  webdavUsername: string;
  webdavPath: string;
  hasPassword: boolean;
  s3Endpoint: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKey: string;
  s3Prefix: string;
  hasS3SecretKey: boolean;
};
type DialogState = {
  open: boolean;
  action: string;
  title: string;
  description: string;
  confirmText?: string;
  body?: Record<string, unknown>;
  directChoice?: boolean;
  dangerous?: boolean;
};

const tokenKey = "bypassproxy-admin-secret";
const nodeDelayKey = "bypassproxy-node-delays";

function storedNodeDelays(): Record<string, number | null> {
  try {
    const parsed = JSON.parse(localStorage.getItem(nodeDelayKey) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === null || (typeof value === "number" && Number.isFinite(value) && value > 0)),
    ) as Record<string, number | null>;
  } catch {
    return {};
  }
}

const nodeCountryAliases: Array<[string, string]> = [
  ["United Arab Emirates", "🇦🇪"], ["United States", "🇺🇸"], ["United Kingdom", "🇬🇧"],
  ["South Korea", "🇰🇷"], ["New Zealand", "🇳🇿"], ["South Africa", "🇿🇦"],
  ["Great Britain", "🇬🇧"], ["Türkiye", "🇹🇷"], ["Turkey", "🇹🇷"],
  ["America", "🇺🇸"], ["USA", "🇺🇸"], ["US", "🇺🇸"],
  ["Britain", "🇬🇧"], ["UK", "🇬🇧"], ["GB", "🇬🇧"],
  ["Japan", "🇯🇵"], ["JP", "🇯🇵"], ["香港", "🇭🇰"], ["Hong Kong", "🇭🇰"], ["HK", "🇭🇰"],
  ["台湾", "🇹🇼"], ["Taiwan", "🇹🇼"], ["TW", "🇹🇼"],
  ["新加坡", "🇸🇬"], ["Singapore", "🇸🇬"], ["SG", "🇸🇬"],
  ["韩国", "🇰🇷"], ["Korea", "🇰🇷"], ["KR", "🇰🇷"],
  ["美国", "🇺🇸"], ["中国", "🇨🇳"], ["China", "🇨🇳"], ["CN", "🇨🇳"],
  ["德国", "🇩🇪"], ["Germany", "🇩🇪"], ["DE", "🇩🇪"],
  ["法国", "🇫🇷"], ["France", "🇫🇷"], ["FR", "🇫🇷"],
  ["加拿大", "🇨🇦"], ["Canada", "🇨🇦"], ["CA", "🇨🇦"],
  ["澳大利亚", "🇦🇺"], ["澳洲", "🇦🇺"], ["Australia", "🇦🇺"], ["AU", "🇦🇺"],
  ["俄罗斯", "🇷🇺"], ["Russia", "🇷🇺"], ["RU", "🇷🇺"],
  ["荷兰", "🇳🇱"], ["Netherlands", "🇳🇱"], ["NL", "🇳🇱"],
  ["印度", "🇮🇳"], ["India", "🇮🇳"], ["IN", "🇮🇳"],
  ["阿联酋", "🇦🇪"], ["迪拜", "🇦🇪"], ["UAE", "🇦🇪"], ["AE", "🇦🇪"],
  ["越南", "🇻🇳"], ["Vietnam", "🇻🇳"], ["VN", "🇻🇳"],
  ["泰国", "🇹🇭"], ["Thailand", "🇹🇭"], ["TH", "🇹🇭"],
  ["马来西亚", "🇲🇾"], ["Malaysia", "🇲🇾"], ["MY", "🇲🇾"],
  ["菲律宾", "🇵🇭"], ["Philippines", "🇵🇭"], ["PH", "🇵🇭"],
  ["巴西", "🇧🇷"], ["Brazil", "🇧🇷"], ["BR", "🇧🇷"],
  ["西班牙", "🇪🇸"], ["Spain", "🇪🇸"], ["ES", "🇪🇸"],
  ["意大利", "🇮🇹"], ["Italy", "🇮🇹"], ["IT", "🇮🇹"],
  ["瑞士", "🇨🇭"], ["Switzerland", "🇨🇭"], ["CH", "🇨🇭"],
  ["瑞典", "🇸🇪"], ["Sweden", "🇸🇪"], ["SE", "🇸🇪"],
  ["挪威", "🇳🇴"], ["Norway", "🇳🇴"], ["NO", "🇳🇴"],
  ["芬兰", "🇫🇮"], ["Finland", "🇫🇮"], ["FI", "🇫🇮"],
  ["波兰", "🇵🇱"], ["Poland", "🇵🇱"], ["PL", "🇵🇱"],
  ["爱尔兰", "🇮🇪"], ["Ireland", "🇮🇪"], ["IE", "🇮🇪"],
  ["乌克兰", "🇺🇦"], ["Ukraine", "🇺🇦"], ["UA", "🇺🇦"],
  ["以色列", "🇮🇱"], ["Israel", "🇮🇱"], ["IL", "🇮🇱"],
  ["智利", "🇨🇱"], ["Chile", "🇨🇱"], ["CL", "🇨🇱"],
  ["印尼", "🇮🇩"], ["印度尼西亚", "🇮🇩"], ["Indonesia", "🇮🇩"], ["ID", "🇮🇩"],
];

const nodeCountryBoundary = "[\\s\\[\\]【】()（）{}<>|/_\\\\\\-·.,:：#]";

function formatNodeName(name: string) {
  let formatted = name.normalize("NFC");
  for (const [alias, flag] of nodeCountryAliases) {
    if (/^[\u3400-\u9fff]+$/.test(alias)) {
      formatted = formatted.split(alias).join(flag);
      continue;
    }
    const pattern = new RegExp(
      "(^|" + nodeCountryBoundary + ")" + alias.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "(?=$|" + nodeCountryBoundary + "|\\d)",
      "giu",
    );
    formatted = formatted.replace(pattern, (_match, prefix: string) => prefix + flag);
  }
  return formatted;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(tokenKey) || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data as T;
}

function Alert({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <XCircle className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

let overlaySequence = 0;

function useOverlayHistory(open: boolean, onClose: () => void, kind: string) {
  const onCloseRef = useRef(onClose);
  const markerRef = useRef("");
  const activeRef = useRef(false);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const marker = `${kind}:${++overlaySequence}`;
    markerRef.current = marker;
    activeRef.current = true;
    window.history.pushState({ ...(window.history.state || {}), bypassproxyOverlay: marker }, "", window.location.href);

    function handlePopState() {
      if (!activeRef.current || markerRef.current !== marker) return;
      activeRef.current = false;
      markerRef.current = "";
      onCloseRef.current();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (activeRef.current && window.history.state?.bypassproxyOverlay === marker) {
        activeRef.current = false;
        markerRef.current = "";
        window.history.back();
      }
    };
  }, [kind, open]);

  return () => {
    if (!activeRef.current) {
      onCloseRef.current();
      return;
    }
    if (window.history.state?.bypassproxyOverlay === markerRef.current) {
      window.history.back();
      return;
    }
    activeRef.current = false;
    markerRef.current = "";
    onCloseRef.current();
  };
}

function DialogShell({
  title,
  description,
  children,
  footer,
  onClose,
  wide,
  topLayer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  topLayer?: boolean;
}) {
  const closeOverlay = useOverlayHistory(true, onClose, "dialog");
  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent wide={wide} topLayer={topLayer}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description ? <DialogDescription className="mt-1 text-sm text-muted-foreground">{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>{footer || <Button variant="secondary" onClick={closeOverlay}>关闭</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageShell({
  title,
  description,
  children,
  footer,
  onClose,
  wide,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <section className={cn("bp-page-shell bp-route-page", wide && "bp-page-shell-wide")} role="dialog" aria-modal="true">
      <header className="bp-page-header">
        <Button size="icon" variant="ghost" aria-label="返回" title="返回" onClick={onClose}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1>{title}</h1>
        </div>
      </header>
      <div className="bp-page-body">{children}</div>
      {footer ? <div className="bp-page-footer">{footer}</div> : null}
    </section>
  );
}

function Surface({
  page,
  title,
  description,
  children,
  footer,
  onClose,
  wide,
}: {
  page?: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  if (page) return <PageShell title={title} description={description} onClose={onClose} footer={footer} wide={wide}>{children}</PageShell>;
  return <DialogShell title={title} description={description} onClose={onClose} footer={footer} wide={wide}>{children}</DialogShell>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ ok: boolean }>("/api/session", { method: "POST", body: JSON.stringify({ secret }) });
      if (!result.ok) {
        setError("密钥不正确");
        return;
      }
      localStorage.setItem(tokenKey, secret);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-muted/35 p-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader className="border-b-0 pb-2">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">BypassProxy</h1>
              <p className="text-sm text-muted-foreground">管理后台</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <Label>
              登录密钥
              <Input value={secret} onChange={(event) => setSecret(event.target.value)} type="password" placeholder="默认 abc123" />
            </Label>
            {error ? <Alert message={error} /> : null}
            <Button busy={busy} type="submit" className="w-full">登录</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function ActionDialog({
  dialog,
  setDialog,
  running,
  output,
  error,
  onConfirm,
}: {
  dialog: DialogState;
  setDialog: (next: DialogState) => void;
  running: boolean;
  output: string;
  error: string;
  onConfirm: () => void;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output, running]);
  if (!dialog.open) return null;
  return (
    <DialogShell
      title={dialog.title}
      description={dialog.description}
      wide
      topLayer
      onClose={() => setDialog({ ...dialog, open: false })}
      footer={
        <>
          <Button variant="secondary" disabled={running} onClick={() => setDialog({ ...dialog, open: false })}>关闭</Button>
          <Button variant={dialog.dangerous ? "destructive" : "default"} busy={running} onClick={onConfirm}>
            {dialog.confirmText || "开始执行"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {dialog.directChoice !== undefined ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
            <span>
            本次直连下载订阅，不使用下载代理
            </span>
            <Switch
              pressed={dialog.directChoice}
              onPressedChange={(pressed) => setDialog({ ...dialog, directChoice: pressed })}
              disabled={running}
              aria-label="direct subscription download"
            />
          </div>
        ) : null}
        {running ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在执行，请保持页面打开
          </div>
        ) : null}
        {error ? <Alert message={error} /> : null}
        {(output || error) ? (
          <pre ref={outputRef} className="max-h-[42dvh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">{output || error}</pre>
        ) : (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">确认后开始执行，过程和结果会实时显示在这个弹窗里。</div>
        )}
      </div>
    </DialogShell>
  );
}

function HeaderPanel({
  proxyMode,
  modeBusy,
  onModeChange,
}: {
  proxyMode: ProxyMode;
  modeBusy: boolean;
  onModeChange: (mode: ProxyMode) => void;
}) {
  const modes: Array<{ value: ProxyMode; label: string }> = [
    { value: "rule", label: "规则" },
    { value: "global", label: "全局" },
    { value: "direct", label: "直连" },
  ];
  return (
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-4 pt-6 sm:items-center sm:gap-4 sm:px-8 sm:pt-8">
      <h1 className="shrink-0 whitespace-nowrap text-[1.65rem] font-bold leading-none tracking-tight text-primary min-[430px]:text-[2.1rem] sm:text-5xl">BypassProxy</h1>
      <div className="flex shrink-0 items-center gap-2">
        {modeBusy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        <ToggleGroup
          type="single"
          value={proxyMode}
          disabled={modeBusy}
          variant="default"
          size="sm"
          aria-label="代理模式"
          className="rounded-full bg-black p-1"
          onValueChange={(value) => value && onModeChange(value as ProxyMode)}
        >
          {modes.map((mode) => (
            <ToggleGroupItem key={mode.value} value={mode.value} aria-label={mode.label} className="h-8 min-w-11 rounded-full px-2 text-sm text-white data-[state=on]:bg-primary data-[state=on]:text-primary-foreground min-[430px]:h-10 min-[430px]:min-w-14 min-[430px]:px-3 min-[430px]:text-base sm:min-w-20 sm:px-5">
              {mode.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </header>
  );
}

function StatusPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button variant={active ? "success" : "secondary"} onClick={onClick} className="h-8 w-auto min-w-0 gap-1.5 rounded-[12px] px-2 text-sm font-normal sm:h-10 sm:gap-2 sm:rounded-[14px] sm:px-3 sm:text-base">
      <span>{label}</span>
      <span className="grid size-5 place-items-center rounded-full bg-black/20 sm:size-6">
        {active ? <Check className="size-3 sm:size-4" /> : <XCircle className="size-3 sm:size-4" />}
      </span>
    </Button>
  );
}

function ServiceStatus({ status, openAction }: { status: Status | null; openAction: (dialog: DialogState) => void }) {
  const singBoxActive = status?.services.singBox === "active";
  const forwardingActive = status?.services.forwardTimer === "active";
  const tunActive = status?.tunEnabled !== false;

  function toggleSingBox() {
    openAction(singBoxActive
      ? { open: true, action: "pause-proxy", title: "暂停代理", description: "暂停 sing-box 代理服务", confirmText: "暂停代理", dangerous: true }
      : { open: true, action: "resume-proxy", title: "鍚姩浠ｇ悊", description: "鍚姩 sing-box 骞堕噸鏂板簲鐢ㄨ浆鍙戣鍒欍€?", confirmText: "鍚姩浠ｇ悊" });
  }

  return (
    <Card className="mx-5 bg-black text-primary sm:mx-8">
      <CardContent className="flex min-w-0 items-center justify-between gap-2 px-3 py-4 min-[430px]:gap-4 min-[430px]:px-5 min-[430px]:py-5 sm:px-8 sm:py-6">
        <div className="flex min-w-0 cursor-pointer items-baseline gap-2" role="button" tabIndex={0} title="点击切换 Sing-box 状态" onClick={toggleSingBox} onKeyDown={(event) => event.key === "Enter" && toggleSingBox()}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="truncate text-xl font-normal min-[430px]:text-2xl">Sing-box</div>
            {singBoxActive ? <Check className="size-7 rounded-full bg-primary p-1 text-black" /> : <XCircle className="size-7 text-destructive" />}
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 min-[430px]:gap-1.5 sm:gap-3">
          <StatusPill label="TUN" active={tunActive} onClick={() => openAction(tunActive
            ? { open: true, action: "disable-tun", title: "关闭 TUN", description: "关闭 TUN", confirmText: "关闭 TUN", dangerous: true }
            : { open: true, action: "enable-tun", title: "寮€鍚? TUN", description: "寮€鍚? TUN", confirmText: "寮€鍚? TUN" })} />
          <StatusPill label="NAT" active={forwardingActive} onClick={() => openAction(forwardingActive
            ? { open: true, action: "disable-forwarding", title: "停用 NAT", description: "停用 NAT", confirmText: "停用 NAT", dangerous: true }
            : { open: true, action: "apply-forwarding", title: "鍚敤 NAT", description: "鍚敤 NAT", confirmText: "鍚敤 NAT" })} />
          <Button
            size="sm"
            variant={singBoxActive ? "success" : "secondary"}
            className="hidden"
            title={singBoxActive ? "点击暂停代理服务" : "点击启动代理服务"}
            onClick={() => openAction(singBoxActive
              ? { open: true, action: "pause-proxy", title: "暂停代理", description: "暂停 sing-box 代理服务，管理后台仍可使用。", confirmText: "暂停代理", dangerous: true }
              : { open: true, action: "resume-proxy", title: "启动代理", description: "启动 sing-box，并重新应用旁路由转发规则。", confirmText: "启动代理" })}
          >
            {singBoxActive ? <Check data-icon="inline-start" /> : <XCircle data-icon="inline-start" />}
            {singBoxActive ? "已启动" : "已停止"}
          </Button>
          <Button
            size="sm"
            variant={tunActive ? "success" : "secondary"}
            className="hidden"
            title={tunActive ? "点击关闭 TUN" : "点击开启 TUN"}
            onClick={() => openAction(tunActive
              ? { open: true, action: "disable-tun", title: "关闭 TUN", description: "关闭透明代理 TUN，并重新生成配置和转发规则。", confirmText: "关闭 TUN", dangerous: true }
              : { open: true, action: "enable-tun", title: "开启 TUN", description: "开启透明代理 TUN，并重新生成配置和转发规则。", confirmText: "开启 TUN" })}
          >
            {tunActive ? <Check data-icon="inline-start" /> : <XCircle data-icon="inline-start" />}
            {tunActive ? "TUN 开启" : "TUN 关闭"}
          </Button>
          <Button
            size="sm"
            variant={forwardingActive ? "success" : "secondary"}
            className="hidden"
            title={forwardingActive ? "点击停用网关转发" : "点击启用网关转发"}
            onClick={() => openAction(forwardingActive
              ? { open: true, action: "disable-forwarding", title: "停用网关转发", description: "停用定时转发服务，并清理 BypassProxy 写入的转发/NAT 规则。手机将不能再使用本机作为旁路由网关。", confirmText: "停用转发", dangerous: true }
              : { open: true, action: "apply-forwarding", title: "启用网关转发", description: "启用定时转发服务，并应用旁路由转发/NAT 规则。", confirmText: "启用转发" })}
          >
            {forwardingActive ? <Check data-icon="inline-start" /> : <XCircle data-icon="inline-start" />}
            {forwardingActive ? "转发开启" : "转发关闭"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceStatusV2({ status, openAction }: { status: Status | null; openAction: (dialog: DialogState) => void }) {
  const singBoxActive = status?.services.singBox === "active";
  const tunActive = status?.tunEnabled !== false;
  const natActive = status?.services.forwardTimer === "active";

  const run = (action: string, title: string, dangerous = false) => openAction({
    open: true,
    action,
    title,
    description: title,
    confirmText: title,
    dangerous,
  });

  return (
    <Card className="mx-3 bg-black text-primary min-[430px]:mx-5 sm:mx-8">
      <CardContent className="flex min-w-0 items-center justify-between gap-2 px-3 py-4 min-[430px]:gap-4 min-[430px]:px-5 min-[430px]:py-5 sm:px-8 sm:py-6">
        <button type="button" className="flex min-w-0 items-center gap-2 bg-transparent p-0 text-left text-xl font-normal text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary min-[430px]:gap-3 min-[430px]:text-2xl" onClick={() => run(singBoxActive ? "pause-proxy" : "resume-proxy", singBoxActive ? "Pause sing-box" : "Start sing-box", singBoxActive)}>
          <span className="truncate">Sing-box</span>
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-black">
            {singBoxActive ? <Check className="size-5" /> : <XCircle className="size-5" />}
          </span>
        </button>
        <div className="flex shrink-0 items-center justify-end gap-1 min-[430px]:gap-1.5 sm:gap-3">
          <StatusPill label="TUN" active={tunActive} onClick={() => run(tunActive ? "disable-tun" : "enable-tun", tunActive ? "Disable TUN" : "Enable TUN", tunActive)} />
          <StatusPill label="NAT" active={natActive} onClick={() => run(natActive ? "disable-forwarding" : "apply-forwarding", natActive ? "Disable NAT" : "Enable NAT", natActive)} />
        </div>
      </CardContent>
    </Card>
  );
}

function LegacyNetworkOverview({ status }: { status: Status | null }) {
  const singBoxActive = status?.services.singBox === "active";
  const tunActive = status?.tunEnabled !== false;
  const natActive = status?.services.forwardTimer === "active";
  const flowActive = singBoxActive && tunActive && natActive;
  const modeLabel = status?.proxyMode === "global" ? "全局" : status?.proxyMode === "direct" ? "直连" : "规则";

  const directPath = flowActive && status?.proxyMode !== "global";
  const proxyPath = flowActive && status?.proxyMode !== "direct";
  const Node = ({ icon: Icon, label, detail, active, className }: { icon: LucideIcon; label: string; detail: string; active: boolean; className?: string }) => (
    <div className={cn("bp-topology-node", active && "is-active", className)}>
      <div className="bp-topology-icon"><Icon className="size-5 sm:size-6" /></div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-white sm:text-sm">{label}</div>
        <div className="truncate text-[10px] text-white/45 sm:text-xs">{detail}</div>
      </div>
    </div>
  );

  return (
    <div className="mx-3 my-4 min-w-0 px-3 py-6 min-[430px]:mx-5 min-[430px]:my-5 min-[430px]:px-4 min-[430px]:py-7 sm:mx-8 sm:my-6 sm:px-6 sm:py-8" aria-label="网络原理概览">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-white/70 sm:text-sm">
          <Activity className={cn("size-4", flowActive && "text-primary animate-pulse")} />
          <span>实时网络链路</span>
        </div>
        <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70 sm:text-xs">{modeLabel}模式</div>
      </div>
      <div className="bp-topology-scroll">
        <div className="bp-topology">
        <Node icon={Wifi} label="局域网设备" detail="手机 / 电脑" active={natActive} />
        <div className={cn("bp-topology-path", natActive && "is-active")}><span /></div>
        <Node icon={Network} label="BypassProxy" detail="网关转发" active={natActive} />
        <div className={cn("bp-topology-path", singBoxActive && tunActive && "is-active")}><span /></div>
        <Node icon={Shield} label="sing-box TUN" detail={tunActive ? "透明代理" : "已关闭"} active={singBoxActive && tunActive} />
        <div className="bp-topology-split">
          <div className={cn("bp-topology-path", directPath && "is-active")}><span /></div>
          <Node icon={Route} label="直连" detail="国内流量" active={directPath} />
          <div className={cn("bp-topology-path", proxyPath && "is-active")}><span /></div>
          <Node icon={Shield} label="代理节点" detail="海外流量" active={proxyPath} />
        </div>
        <div className={cn("bp-topology-path", flowActive && "is-active")}><span /></div>
          <Node icon={Globe2} label="互联网" detail="目标服务" active={flowActive} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white/45 sm:text-xs">
        <span className="inline-flex items-center gap-1.5"><i className={cn("size-1.5 rounded-full", natActive ? "bg-primary" : "bg-white/25")} />网关</span>
        <span className="inline-flex items-center gap-1.5"><i className={cn("size-1.5 rounded-full", tunActive ? "bg-primary" : "bg-white/25")} />TUN</span>
        <span className="inline-flex items-center gap-1.5"><i className={cn("size-1.5 rounded-full", singBoxActive ? "bg-primary" : "bg-white/25")} />代理服务</span>
        <span className="ml-auto">{flowActive ? "链路正常" : "链路未完整建立"}</span>
      </div>
    </div>
  );
}

function LegacyNetworkOverviewV2({ status, openAction }: { status: Status | null; openAction: (dialog: DialogState) => void }) {
  const singBoxActive = status?.services.singBox === "active";
  const kernelLabel = status?.services.kernel === "mihomo" || status?.kernel === "mihomo" ? "mihomo" : "sing-box";
  const tunActive = status?.tunEnabled !== false;
  const natActive = status?.services.forwardTimer === "active";
  const flowActive = singBoxActive && tunActive && natActive;
  const directPath = flowActive && status?.proxyMode !== "global";
  const proxyPath = flowActive && status?.proxyMode !== "direct";
  const modeLabel = status?.proxyMode === "global" ? "全局" : status?.proxyMode === "direct" ? "直连" : "规则";
  const [activeDevices, setActiveDevices] = useState<string[]>([]);

  useEffect(() => {
    let disposed = false;
    async function loadActiveDevices() {
      try {
        const data = await api<{ connections?: ClashConnection[] }>("/api/connections");
        const devices = [...new Set((data.connections || [])
          .map((connection) => connection.metadata?.sourceIP)
          .filter((address): address is string => Boolean(address) && address !== "127.0.0.1" && address !== "::1"))];
        if (!disposed) setActiveDevices(devices);
      } catch {
        if (!disposed) setActiveDevices([]);
      }
    }
    loadActiveDevices();
    const timer = window.setInterval(loadActiveDevices, 4000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const run = (action: string, title: string, dangerous = false) => openAction({ open: true, action, title, description: title, confirmText: title, dangerous });
  const Node = ({ icon: Icon, label, detail, active, className }: { icon: LucideIcon; label: string; detail: string; active: boolean; className: string }) => (
    <div className={cn("bp-graph-node", active && "is-active", className)} title={`${label}：${detail}`}>
      <div className="bp-graph-icon"><Icon className="size-5 sm:size-6" /></div>
      <div className="min-w-0 text-center">
        <div className="truncate text-xs font-medium text-white sm:text-sm">{label}</div>
        <div className="bp-graph-detail truncate text-[10px] text-white/45 sm:text-xs">{detail}</div>
      </div>
    </div>
  );

  const Path = ({ id, d, active }: { id: string; d: string; active: boolean }) => (
    <>
      <path id={id} className={cn("bp-graph-path", active && "is-active")} d={d} vectorEffect="non-scaling-stroke">
        {active ? <animate attributeName="stroke-dashoffset" values="0;-14" dur="1.8s" repeatCount="indefinite" /> : null}
      </path>
      {active ? (
        <>
          <circle className="bp-photon" r="0.65">
            <animate attributeName="opacity" values="0.15;0.8;0.15" dur="1.2s" repeatCount="indefinite" />
            <animateMotion dur="1.2s" repeatCount="indefinite" rotate="auto"><mpath href={`#${id}`} /></animateMotion>
          </circle>
        </>
      ) : null}
    </>
  );

  return (
    <div className="mx-3 my-4 min-w-0 px-3 py-6 min-[430px]:mx-5 min-[430px]:my-5 min-[430px]:px-4 min-[430px]:py-7 sm:mx-8 sm:my-6 sm:px-6 sm:py-8" aria-label="网络原理概览">
      <div className="hidden">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-white/70 sm:text-sm">
          <Activity className={cn("size-4", flowActive && "animate-pulse text-primary")} />
          <span>实时网络链路</span>
        </div>
        <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/70 sm:text-xs">{modeLabel}模式</div>
      </div>
      <div className="bp-topology-meta mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white sm:text-xs">
        <span className="inline-flex items-center gap-1.5"><i className={cn("size-1.5 rounded-full", natActive ? "bg-primary" : "bg-white/25")} />网关</span>
        <span className="inline-flex items-center gap-1.5"><i className={cn("size-1.5 rounded-full", tunActive ? "bg-primary" : "bg-white/25")} />TUN</span>
        <span className="inline-flex items-center gap-1.5"><i className={cn("size-1.5 rounded-full", singBoxActive ? "bg-primary" : "bg-white/25")} />代理内核 · {kernelLabel}</span>
      </div>
      <div className="bp-topology-graph">
        <svg className="bp-graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <Path id="path-lan-gateway" d="M 8 50 C 14 50, 18 50, 22 50" active={natActive} />
          <Path id="path-gateway-tun" d="M 27 50 C 33 50, 37 50, 42 50" active={singBoxActive && tunActive} />
          <Path id="path-tun-direct" d="M 47 50 C 54 50, 56 22, 63 22" active={directPath} />
          <Path id="path-tun-proxy" d="M 47 50 C 54 50, 56 78, 63 78" active={proxyPath} />
          <Path id="path-direct-internet" d="M 68 22 C 77 22, 79 50, 88 50" active={directPath} />
          <Path id="path-proxy-internet" d="M 68 78 C 77 78, 79 50, 88 50" active={proxyPath} />
        </svg>
        <Node icon={Wifi} label="设备" detail={`${activeDevices.length} 台活跃`} active={natActive} className="bp-graph-source" />
        <Node icon={Network} label="网关" detail="旁路由" active={natActive} className="bp-graph-gateway" />
        <Node icon={Shield} label="TUN" detail={tunActive ? "透明代理" : "已关闭"} active={singBoxActive && tunActive} className="bp-graph-tun" />
        <Node icon={Route} label="直连" detail="国内流量" active={directPath} className="bp-graph-direct" />
        <Node icon={Shield} label={kernelLabel} detail="海外流量" active={proxyPath} className="bp-graph-proxy" />
        <Node icon={Globe2} label="外网" detail="目标服务" active={flowActive} className="bp-graph-internet" />
      </div>
      <div className="bp-active-devices mt-3 flex min-w-0 items-center gap-2 text-[10px] text-white/55 sm:text-xs">
        <Wifi className="size-3.5 shrink-0 text-primary" />
        <span className="shrink-0">活跃设备 {activeDevices.length}</span>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {activeDevices.slice(0, 5).map((address) => <span key={address} className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/75">{address}</span>)}
          {activeDevices.length > 5 ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/55">+{activeDevices.length - 5}</span> : null}
          {!activeDevices.length ? <span className="text-white/35">暂无活跃连接</span> : null}
        </div>
      </div>
    </div>
  );
}

type FunctionTileProps = Omit<React.ComponentPropsWithoutRef<typeof Button>, "children" | "title"> & {
  title: string;
  icon: LucideIcon;
};

const FunctionTile = React.forwardRef<HTMLButtonElement, FunctionTileProps>(({ title, icon: Icon, className, ...props }, ref) => (
  <Button
    ref={ref}
    variant="ghost"
    className={cn("group h-auto min-w-0 flex-col gap-2.5 p-0 text-foreground hover:bg-transparent", className)}
    title={title}
    aria-label={title}
    {...props}
  >
    <span className="grid size-14 place-items-center rounded-[18px] bg-[#323232] text-white transition-colors group-hover:bg-[#3a3a3a] min-[430px]:size-16 min-[430px]:rounded-[22px] sm:size-[72px]">
      <Icon data-icon="tile" />
    </span>
    <span className="max-w-full truncate text-sm font-normal text-white sm:text-base">{title}</span>
  </Button>
));
FunctionTile.displayName = "FunctionTile";

type SheetActionItem = { label: string; icon: LucideIcon; onSelect: () => void; destructive?: boolean };

function SheetAction({ title, items, children }: { title: string; items: SheetActionItem[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeOverlay = useOverlayHistory(open, () => setOpen(false), "sheet");

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => nextOpen ? setOpen(true) : closeOverlay()}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="text-xl font-medium">{title}</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">选择要执行的操作</SheetDescription>
        </SheetHeader>
        <div className="grid gap-2">
          {items.map(({ label, icon: Icon, onSelect, destructive }) => (
            <SheetClose asChild key={label}>
              <Button variant="ghost" className={cn("h-12 justify-start rounded-xl bg-muted px-4 text-base hover:bg-accent", destructive && "text-destructive hover:text-destructive")} onClick={onSelect}>
                <Icon data-icon="inline-start" />
                {label}
              </Button>
            </SheetClose>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function KernelManager({ openAction }: { openAction: (dialog: DialogState) => void }) {
  return (
    <SheetAction title="代理内核" items={[
      { label: "使用 sing-box", icon: Shield, onSelect: () => openAction({ open: true, action: "switch-kernel-sing-box", title: "切换到 sing-box", description: "停止 mihomo，恢复 sing-box，并重新应用旁路由转发。", confirmText: "切换" }) },
      { label: "使用 mihomo", icon: Network, onSelect: () => openAction({ open: true, action: "switch-kernel-mihomo", title: "切换到 mihomo", description: "安装并检查 mihomo，停止 sing-box 后启动 mihomo。失败会尝试恢复 sing-box。", confirmText: "切换" }) },
      { label: "检查 mihomo", icon: CheckCircle2, onSelect: () => openAction({ open: true, action: "check-mihomo", title: "检查 mihomo", description: "下载并检查 mihomo 配置，不会切换当前运行内核。", confirmText: "检查" }) },
    ]}>
      <FunctionTile title="代理内核" icon={Cpu} />
    </SheetAction>
  );
}

function SettingsListItem({
  title,
  description,
  icon: Icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button type="button" className="bp-settings-row" onClick={onClick}>
      <span className="bp-settings-row-icon"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="mt-1 block truncate text-xs text-white/45">{description}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-white/40" />
    </button>
  );
}

function SettingsSwitchItem({
  title,
  description,
  icon: Icon,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="bp-settings-row">
      <span className="bp-settings-row-icon"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="mt-1 block truncate text-xs text-white/45">{description}</span>
      </span>
      <Switch pressed={checked} onPressedChange={onCheckedChange} disabled={disabled} aria-label={title} />
    </div>
  );
}

function ControlCenter({
  status,
  openAction,
  openPassword,
  openBasicSettings,
  openNodes,
  openCustomRules,
  openSync,
  showRecent,
}: {
  status: Status | null;
  openAction: (dialog: DialogState) => void;
  openPassword: () => void;
  openBasicSettings: () => void;
  openNodes: () => void;
  openCustomRules: () => void;
  openSync: () => void;
  showRecent: () => void;
}) {
  const actions = [
    {
      group: "网络维护",
      title: "网络诊断",
      description: "检查 DNS、转发、服务状态和节点连通性。",
      icon: Bug,
      onClick: () => openAction({ open: true, action: "diagnose-network", title: "网络诊断", description: "检查服务、DNS、转发、订阅节点等常见问题。", confirmText: "开始诊断" }),
    },
    {
      group: "网络维护",
      title: "旁路由测试",
      description: "模拟家用终端使用旁路由 IP 作为网关和 DNS，验证 DNS、国内直连与海外代理链路。",
      icon: Wifi,
      onClick: () => openAction({ open: true, action: "test-lan-client", title: "旁路由可用性测试", description: "创建临时隔离终端，模拟设备经过旁路由访问国内和海外网站；结束后自动清理测试环境。", confirmText: "开始测试" }),
    },
    {
      group: "网络维护",
      title: "节点下载测速",
      description: "通过本机专用入口和当前节点下载约 50 MB 测试速度。",
      icon: Gauge,
      onClick: () => openAction({ open: true, action: "speed-test", title: "节点下载测速", description: "测速使用仅监听本机的专用代理入口，下载约 50 MB；只有 sing-box 确认连接经过当前节点后才显示结果，不会影响其他设备。", confirmText: "开始测速" }),
    },
    {
      group: "网络维护",
      title: "检查配置",
      description: "确认 sing-box 配置语法和引用文件是否可用。",
      icon: CheckCircle2,
      onClick: () => openAction({ open: true, action: "check-config", title: "检查配置", description: "运行 sing-box check，确认当前配置是否可用。", confirmText: "检查" }),
    },
    {
      group: "网络维护",
      title: "应用转发/NAT",
      description: "手机设网关不能上网时，优先重新应用这一项。",
      icon: Network,
      onClick: () => openAction({ open: true, action: "apply-forwarding", title: "应用转发/NAT", description: "重新写入旁路由转发规则，手机设网关不能上网时常用。", confirmText: "应用" }),
    },
    {
      group: "网络维护",
      title: "一键修复",
      description: "修复脚本入口、重新生成配置、检查配置、重启服务并应用转发。",
      icon: Wrench,
      onClick: () => openAction({ open: true, action: "repair", title: "一键修复", description: "适合服务异常、配置丢失、端口或转发规则不正常时使用。", confirmText: "开始修复" }),
    },
    {
      group: "常用控制",
      title: "重启 sing-box",
      description: "代理服务异常、配置应用后可用它恢复服务。",
      icon: Power,
      onClick: () => openAction({ open: true, action: "restart-sing-box", title: "重启 sing-box", description: "重启代理服务，通常用于配置修改后恢复服务。", confirmText: "重启" }),
    },
    {
      group: "常用控制",
      title: "暂停代理",
      description: "停止 sing-box，不停止 Web 管理页。家里设备会暂时不能走旁路由。",
      icon: Power,
      onClick: () => openAction({ open: true, action: "pause-proxy", title: "暂停代理", description: "只停止 sing-box 代理服务，Web 管理页仍可打开，之后可以点“恢复代理”。", confirmText: "暂停代理", dangerous: true }),
    },
    {
      group: "常用控制",
      title: "恢复代理",
      description: "重新生成并检查配置，启动 sing-box，再应用转发/NAT。",
      icon: RefreshCcw,
      onClick: () => openAction({ open: true, action: "resume-proxy", title: "恢复代理", description: "启动 sing-box 并重新应用旁路由转发规则。", confirmText: "恢复代理" }),
    },
    {
      group: "节点与分流",
      title: "节点中心",
      description: "切换节点、测试延迟和管理活动连接，高级功能仍可进入 MetaCubeXD。",
      icon: PanelTop,
      onClick: openNodes,
      tools: [
        { label: "打开节点面板", icon: ExternalLink, onClick: () => undefined },
        { label: "更新节点面板", icon: RefreshCcw, onClick: () => openAction({ open: true, action: "update-webui", title: "更新节点面板", description: "检查并更新 MetaCubeXD 静态面板。", confirmText: "更新" }) },
      ],
    },
    {
      group: "节点与分流",
      title: "更新分流规则",
      description: "检查国内 geosite/geoip 规则，有变化才下载。",
      icon: Route,
      onClick: () => openAction({ open: true, action: "update-rulesets", title: "更新国内分流规则", description: "检查 geosite-cn 和 geoip-cn，有变化才会下载。", confirmText: "更新" }),
    },
    {
      group: "节点与分流",
      title: "自定义分流",
      description: "添加直连或强制代理的域名、IP/CIDR，保存后应用配置生效。",
      icon: Globe2,
      onClick: openCustomRules,
    },
    {
      group: "设置与备份",
      title: "备份同步",
      description: "本地备份配置，也可同步到 WebDAV，换机器或误操作后可恢复。",
      icon: ArchiveRestore,
      onClick: openSync,
    },
    {
      group: "设置与备份",
      title: "更新脚本",
      description: "从 GitHub 检查并更新 BypassProxy 程序本体。",
      icon: RefreshCcw,
      onClick: () => openAction({ open: true, action: "update-core", title: "更新 BypassProxy 脚本", description: "从 GitHub 检查并更新本项目脚本。更新过程中管理后台可能会短暂重启。", confirmText: "更新脚本" }),
    },
    {
      group: "设置与备份",
      title: "基础设置",
      description: "修改端口、LAN 信息、DNS、订阅 User-Agent 和下载代理。",
      icon: Save,
      onClick: openBasicSettings,
    },
    {
      group: "设置与备份",
      title: "修改密钥",
      description: "修改管理后台和节点面板共用的登录密钥。",
      icon: KeyRound,
      onClick: openPassword,
    },
    {
      group: "设置与备份",
      title: "最近结果",
      description: "查看上一次操作摘要。",
      icon: Activity,
      onClick: showRecent,
    },
  ];
  const actionByTitle = (title: string) => actions.find((action) => action.title === title);
  const actionRow = (title: string) => {
    const action = actionByTitle(title);
    return action ? <SettingsListItem key={title} title={title} description={action.description} icon={action.icon} onClick={action.onClick} /> : null;
  };
  return (
    <section className="bp-settings-page">
      <header className="bp-app-topbar bp-settings-heading">
        <h1>设置</h1>
      </header>
      <div className="grid gap-8">
        <section className="bp-settings-group">
          <h2>运行控制</h2>
          <div className="bp-settings-list">
            <SheetAction title="代理服务" items={[
          { label: "重启代理", icon: Power, onSelect: () => openAction({ open: true, action: "restart-sing-box", title: "重启 sing-box", description: "重启代理服务", confirmText: "重启" }) },
          { label: "暂停代理", icon: Power, destructive: true, onSelect: () => openAction({ open: true, action: "pause-proxy", title: "暂停代理", description: "停止 sing-box 代理服务", confirmText: "暂停代理", dangerous: true }) },
          { label: "恢复代理", icon: RefreshCcw, onSelect: () => openAction({ open: true, action: "resume-proxy", title: "恢复代理", description: "启动代理并应用转发规则", confirmText: "恢复代理" }) },
        ]}>
              <SettingsListItem title="代理服务" description="重启、暂停或恢复当前代理服务。" icon={Power} onClick={() => undefined} />
        </SheetAction>
            <SheetAction title="代理内核" items={[
              { label: "使用 sing-box", icon: Shield, onSelect: () => openAction({ open: true, action: "switch-kernel-sing-box", title: "切换到 sing-box", description: "停止 mihomo，恢复 sing-box，并重新应用旁路由转发。", confirmText: "切换" }) },
              { label: "使用 mihomo", icon: Network, onSelect: () => openAction({ open: true, action: "switch-kernel-mihomo", title: "切换到 mihomo", description: "安装并检查 mihomo，停止 sing-box 后启动 mihomo。", confirmText: "切换" }) },
              { label: "检查 mihomo", icon: CheckCircle2, onSelect: () => openAction({ open: true, action: "check-mihomo", title: "检查 mihomo", description: "下载并检查 mihomo 配置，不会切换当前运行内核。", confirmText: "检查" }) },
            ]}>
              <SettingsListItem title="代理内核" description={`当前：${status?.kernel || status?.services.kernel || "读取中"}`} icon={Cpu} onClick={() => undefined} />
            </SheetAction>
            <SettingsSwitchItem
              title="TUN 透明代理"
              description="切换透明代理入口。"
              icon={Shield}
              checked={status?.tunEnabled !== false}
              disabled={!status}
              onCheckedChange={(checked) => openAction(checked
                ? { open: true, action: "enable-tun", title: "开启 TUN", description: "开启 TUN 透明代理", confirmText: "开启 TUN" }
                : { open: true, action: "disable-tun", title: "关闭 TUN", description: "关闭 TUN 透明代理", confirmText: "关闭 TUN", dangerous: true })}
            />
          </div>
        </section>

        <section className="bp-settings-group">
          <h2>诊断与修复</h2>
          <div className="bp-settings-list">
            {actionRow("网络诊断")}
            {actionRow("旁路由测试")}
            {actionRow("节点下载测速")}
            {actionRow("检查配置")}
            {actionRow("应用转发/NAT")}
            {actionRow("一键修复")}
          </div>
        </section>

        <section className="bp-settings-group">
          <h2>节点与分流</h2>
          <div className="bp-settings-list">
            {actionRow("节点中心")}
            {actionRow("更新分流规则")}
            <SettingsListItem title="自定义分流" description="管理直连和强制代理域名、IP 规则。" icon={Globe2} onClick={openCustomRules} />
            <SheetAction title="更新" items={[
          { label: "更新程序", icon: RefreshCcw, onSelect: () => openAction({ open: true, action: "update-core", title: "更新 BypassProxy 脚本", description: "检查并更新项目脚本", confirmText: "更新脚本" }) },
          { label: "更新节点面板", icon: PanelTop, onSelect: () => openAction({ open: true, action: "update-webui", title: "更新节点面板", description: "检查并更新 MetaCubeXD 面板", confirmText: "更新" }) },
          { label: "更新分流规则", icon: Globe2, onSelect: () => openAction({ open: true, action: "update-rulesets", title: "更新国内分流规则", description: "检查并更新 geosite/geoip 规则", confirmText: "更新" }) },
        ]}>
              <SettingsListItem title="更新组件" description="更新脚本、节点面板或分流规则。" icon={RefreshCcw} onClick={() => undefined} />
        </SheetAction>
          </div>
        </section>

        <section className="bp-settings-group">
          <h2>系统与备份</h2>
          <div className="bp-settings-list">
            <SettingsListItem title="基础设置" description="选择网卡并管理端口、DNS 和订阅下载设置。" icon={Save} onClick={openBasicSettings} />
            <SettingsListItem title="修改密钥" description="修改管理后台和节点面板共用的登录密钥。" icon={KeyRound} onClick={openPassword} />
            <SettingsListItem title="备份同步" description="配置 WebDAV 或 S3，并执行备份与恢复。" icon={ArchiveRestore} onClick={openSync} />
            <SettingsListItem title="最近结果" description="查看上一次操作的摘要结果。" icon={Activity} onClick={showRecent} />
          </div>
        </section>
      </div>
    </section>
  );
}

function PasswordDialog({ onClose, onPasswordChanged, page = false }: { onClose: () => void; onPasswordChanged: () => void; page?: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function changePassword() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<ActionResult>("/api/settings/panel-secret", {
        method: "POST",
        body: JSON.stringify({ current, newSecret: next, confirm }),
      });
      setMessage(result.message || "登录密钥已修改");
      localStorage.removeItem(tokenKey);
      window.setTimeout(onPasswordChanged, 900);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface
      page={page}
      title="修改登录密钥"
      description="管理后台和节点面板共用这个密钥。"
      onClose={onClose}
      footer={
        <>
          <Button busy={busy} disabled={!current || !next || !confirm} onClick={changePassword}>保存</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Label>
          当前密钥
          <Input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Label>
        <Label>
          新密钥
          <Input type="password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Label>
        <Label>
          确认新密钥
          <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Label>
        {message ? <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</div> : null}
      </div>
    </Surface>
  );
}

function TextDialog({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <DialogShell title={title} description="最近一次操作的摘要。完整实时输出仍会显示在执行弹窗里。" onClose={onClose} wide>
      <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">{content || "暂无操作"}</pre>
    </DialogShell>
  );
}

function BasicSettingsDialog({ onClose, setResult, page = false }: { onClose: () => void; setResult: (result: string) => void; page?: boolean }) {
  const empty: BasicSettings = {
    LAN_IF: "",
    LAN_NET: "",
    LAN_IP: "",
    PROXY_PORT: "",
    PANEL_PORT: "",
    ADMIN_PORT: "",
    TUN_ENABLE: "1",
    DNS1: "",
    DNS2: "",
    SUBSCRIBE_USER_AGENT: "",
    DOWNLOAD_PROXY: "",
  };
  const [settings, setSettings] = useState<BasicSettings>(empty);
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const selectedInterface = interfaces.find((item) => item.name === settings.LAN_IF);

  useEffect(() => {
    let alive = true;
    api<{ settings: BasicSettings; interfaces: NetworkInterface[] }>("/api/settings/basic")
      .then((data) => {
        if (!alive) return;
        setInterfaces(data.interfaces || []);
        setSettings({ ...empty, ...data.settings, TUN_ENABLE: data.settings.TUN_ENABLE || "1" });
      })
      .catch((err) => {
        if (alive) setMessage(err instanceof Error ? err.message : "读取失败");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function update(key: keyof BasicSettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function toggleTun(enabled: boolean) {
    update("TUN_ENABLE", enabled ? "1" : "0");
  }

  function chooseInterface(name: string) {
    const match = interfaces.find((item) => item.name === name);
    setSettings((current) => ({
      ...current,
      LAN_IF: name,
      LAN_IP: match?.address || current.LAN_IP,
      LAN_NET: match?.network || current.LAN_NET,
    }));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<ActionResult>("/api/settings/basic", { method: "POST", body: JSON.stringify(settings) });
      const text = result.message || "基础设置已保存";
      setMessage(text);
      setResult(text);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface
      page={page}
      title="基础设置"
      description="一般只需要选 LAN 网卡。旁路由 IP 和 LAN 网段会根据网卡自动识别。"
      onClose={onClose}
      wide
      footer={
        <>
          <Button busy={busy} onClick={save}>保存</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">网络识别</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">选择家里设备能访问到的那张网卡。手机设置网关时使用下面识别出的旁路由 IP。</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label className="sm:col-span-2">
              LAN 网卡
              <Select value={settings.LAN_IF} onValueChange={chooseInterface} disabled={busy || interfaces.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="未识别到可用网卡" />
                </SelectTrigger>
                <SelectContent>
                  {interfaces.map((item) => (
                    <SelectItem key={`${item.name}-${item.cidr}`} value={item.name}>
                      {item.name} - {item.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <div className="rounded-md border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground">旁路由 IP</div>
              <div className="mt-1 truncate text-sm font-medium">{selectedInterface?.address || settings.LAN_IP || "未识别"}</div>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground">LAN 网段</div>
              <div className="mt-1 truncate text-sm font-medium">{selectedInterface?.network || settings.LAN_NET || "未识别"}</div>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="flex items-center justify-between gap-4 rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent"
          onClick={() => toggleTun(settings.TUN_ENABLE !== "1")}
          disabled={busy}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold">TUN 透明代理</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">开启后，手机把网关指向旁路由 IP 就能自动分流代理；关闭后只保留显式代理端口。</p>
          </div>
          <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", settings.TUN_ENABLE === "1" ? "bg-primary" : "bg-muted-foreground/30")}>
            <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-background transition-transform", settings.TUN_ENABLE === "1" ? "translate-x-6" : "translate-x-1")} />
          </span>
        </button>

        <div className="grid gap-4 sm:grid-cols-3">
          <Label>
            代理端口
            <Input value={settings.PROXY_PORT} onChange={(event) => update("PROXY_PORT", event.target.value)} disabled={busy} />
          </Label>
          <Label>
            节点面板端口
            <Input value={settings.PANEL_PORT} onChange={(event) => update("PANEL_PORT", event.target.value)} disabled={busy} />
          </Label>
          <Label>
            管理后台端口
            <Input value={settings.ADMIN_PORT} onChange={(event) => update("ADMIN_PORT", event.target.value)} disabled={busy} />
          </Label>
        </div>

        <details className="rounded-lg border bg-background">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">高级设置</summary>
          <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
            <Label>
              旁路由 IP
              <Input value={settings.LAN_IP} onChange={(event) => update("LAN_IP", event.target.value)} disabled={busy} />
            </Label>
            <Label>
              LAN 网段
              <Input value={settings.LAN_NET} onChange={(event) => update("LAN_NET", event.target.value)} disabled={busy} />
            </Label>
            <Label>
              DNS 1
              <Input value={settings.DNS1} onChange={(event) => update("DNS1", event.target.value)} disabled={busy} />
            </Label>
            <Label>
              DNS 2
              <Input value={settings.DNS2} onChange={(event) => update("DNS2", event.target.value)} disabled={busy} />
            </Label>
            <Label>
              订阅 User-Agent
              <Input value={settings.SUBSCRIBE_USER_AGENT} onChange={(event) => update("SUBSCRIBE_USER_AGENT", event.target.value)} disabled={busy} />
            </Label>
            <Label>
              下载代理
              <Input value={settings.DOWNLOAD_PROXY} placeholder="例如 http://127.0.0.1:7890，可留空" onChange={(event) => update("DOWNLOAD_PROXY", event.target.value)} disabled={busy} />
            </Label>
          </div>
        </details>

        {message ? <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</div> : null}
      </div>
    </Surface>
  );
}


function CustomRulesDialog({
  onClose,
  setResult,
  openAction,
  page = false,
}: {
  onClose: () => void;
  setResult: (result: string) => void;
  openAction: (dialog: DialogState) => void;
  page?: boolean;
}) {
  const empty: CustomRules = { directDomains: [], directIps: [], proxyDomains: [], proxyIps: [] };
  const emptyDrafts: Record<keyof CustomRules, string> = { directDomains: "", directIps: "", proxyDomains: "", proxyIps: "" };
  const [rules, setRules] = useState<CustomRules>(empty);
  const [drafts, setDrafts] = useState<Record<keyof CustomRules, string>>(emptyDrafts);
  const [activeTab, setActiveTab] = useState<keyof CustomRules>("directDomains");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  function textFromRules(nextRules: CustomRules) {
    return {
      directDomains: nextRules.directDomains.join("\n"),
      directIps: nextRules.directIps.join("\n"),
      proxyDomains: nextRules.proxyDomains.join("\n"),
      proxyIps: nextRules.proxyIps.join("\n"),
    };
  }

  function rulesFromText() {
    return (Object.keys(drafts) as Array<keyof CustomRules>).reduce((result, key) => {
      result[key] = drafts[key].split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      return result;
    }, { ...empty });
  }

  useEffect(() => {
    let alive = true;
    api<{ rules: CustomRules }>("/api/custom-rules")
      .then((data) => {
        if (!alive) return;
        const nextRules = { ...empty, ...data.rules };
        setRules(nextRules);
        setDrafts(textFromRules(nextRules));
      })
      .catch((err) => {
        if (alive) setMessage(err instanceof Error ? err.message : "读取失败");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function update(key: keyof CustomRules, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  async function save(apply: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<ActionResult & { rules: CustomRules }>("/api/custom-rules", { method: "POST", body: JSON.stringify(rulesFromText()) });
      if (result.rules) {
        const nextRules = { ...empty, ...result.rules };
        setRules(nextRules);
        setDrafts(textFromRules(nextRules));
      }
      const text = result.message || "自定义分流规则已保存";
      setMessage(text);
      setResult(text);
      if (apply) {
        onClose();
        openAction({ open: true, action: "apply-config", title: "应用自定义分流", description: "重新生成 sing-box 配置并重启代理服务，让自定义分流立即生效。", confirmText: "应用配置" });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ key: keyof CustomRules; title: string; hint: string; placeholder: string; count: number }> = [
    { key: "directDomains", title: "直连域名", hint: "这些域名会绕过代理，适合网盘、NAS、国内服务。", placeholder: "cloud.189.cn\napi.cloud.189.cn\nexample.com", count: rules.directDomains.length },
    { key: "directIps", title: "直连 IP", hint: "支持单个 IP 或 CIDR 网段。", placeholder: "1.2.3.4\n1.2.3.0/24", count: rules.directIps.length },
    { key: "proxyDomains", title: "代理域名", hint: "强制走代理，优先级高于内置直连规则。", placeholder: "github.com\nexample.org", count: rules.proxyDomains.length },
    { key: "proxyIps", title: "代理 IP", hint: "支持单个 IP 或 CIDR 网段，适合固定出口目标。", placeholder: "8.8.8.8\n8.8.4.0/24", count: rules.proxyIps.length },
  ];

  return (
    <Surface
      page={page}
      title="自定义分流"
      description="一行一条。强制代理优先级高于直连，可用来覆盖国内直连规则。"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" busy={busy} onClick={() => save(false)}>保存</Button>
          <Button busy={busy} onClick={() => save(true)}>保存并应用</Button>
        </>
      }
    >
      <Tabs>
        <TabsList className="flex min-w-0 max-w-full flex-nowrap justify-start overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} active={activeTab === tab.key} className="min-w-0 max-w-[150px] shrink-0 gap-1 overflow-hidden px-2 text-xs whitespace-nowrap" onClick={() => setActiveTab(tab.key)}>
              <span className="truncate">{tab.title}</span>
              <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground min-[430px]:ml-2 min-[430px]:text-xs">{tab.count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.key} active={activeTab === tab.key}>
            <div className="rounded-lg border bg-muted/25 p-3 text-sm text-muted-foreground">{tab.hint}</div>
            <Label>
              {tab.title}
              <Textarea
                value={drafts[tab.key]}
                onChange={(event) => update(tab.key, event.target.value)}
                placeholder={tab.placeholder}
                disabled={busy}
                spellCheck={false}
                className="min-h-[260px] font-mono"
              />
            </Label>
          </TabsContent>
        ))}
        {message ? <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</div> : null}
      </Tabs>
    </Surface>
  );
}

function BackupSyncDialog({
  onClose,
  openAction,
  setResult,
  page = false,
}: {
  onClose: () => void;
  openAction: (dialog: DialogState) => void;
  setResult: (result: string) => void;
  page?: boolean;
}) {
  const defaultSettings: SyncSettings = {
    provider: "webdav",
    webdavUrl: "",
    webdavUsername: "",
    webdavPath: "BypassProxy",
    hasPassword: false,
    s3Endpoint: "",
    s3Bucket: "",
    s3Region: "auto",
    s3AccessKey: "",
    s3Prefix: "BypassProxy",
    hasS3SecretKey: false,
  };
  const [settings, setSettings] = useState<SyncSettings>(defaultSettings);
  const [webdavPassword, setWebdavPassword] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ settings: SyncSettings }>("/api/settings/sync")
      .then((data) => {
        if (alive) setSettings({ ...defaultSettings, ...data.settings });
      })
      .catch((err) => {
        if (alive) setMessage(err instanceof Error ? err.message : "读取失败");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function update(key: keyof SyncSettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<ActionResult>("/api/settings/sync", {
        method: "POST",
        body: JSON.stringify({ ...settings, webdavPassword, s3SecretKey }),
      });
      const text = result.message || "同步设置已保存";
      setMessage(text);
      setResult(text);
      setWebdavPassword("");
      setS3SecretKey("");
      setSettings((current) => ({ ...current, hasPassword: Boolean(webdavPassword || current.hasPassword), hasS3SecretKey: Boolean(s3SecretKey || current.hasS3SecretKey) }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function syncBody() {
    return { ...settings, webdavPassword, s3SecretKey };
  }

  function run(action: string, title: string, description: string, confirmText: string, dangerous = false, body?: Record<string, unknown>, keepOpen = false) {
    if (!keepOpen) onClose();
    openAction({ open: true, action, title, description, confirmText, dangerous, body });
  }

  const webdavReady = Boolean(settings.webdavUrl && settings.webdavUsername && (settings.hasPassword || webdavPassword));
  const s3RegionReady = Boolean(settings.s3Region && (settings.s3Endpoint || settings.s3Region !== "auto"));
  const s3Ready = Boolean(settings.s3Bucket && s3RegionReady && settings.s3AccessKey && (settings.hasS3SecretKey || s3SecretKey));
  const configured = settings.provider === "s3" ? Boolean(settings.s3Bucket && s3RegionReady && settings.s3AccessKey && settings.hasS3SecretKey) : Boolean(settings.webdavUrl && settings.webdavUsername && settings.hasPassword);
  const canTest = settings.provider === "s3" ? s3Ready : webdavReady;
  const providerName = settings.provider === "s3" ? "S3" : "WebDAV";
  const actions = [
    {
      title: "创建本地备份",
      description: "打包当前配置到本机 /var/backups/bypassproxy。",
      action: "backup-local",
      confirmText: "创建备份",
    },
    {
      title: `测试 ${providerName}`,
      description: "上传并删除一个测试文件，确认账号、路径和写入权限可用。",
      action: "sync-test",
      confirmText: "测试连接",
    },
    {
      title: `上传到 ${providerName}`,
      description: "直接打包并上传到远端，完成后自动清理本机临时文件。",
      action: "sync-upload",
      confirmText: "上传备份",
    },
    {
      title: "恢复最新备份",
      description: `从 ${providerName} 下载最新备份并恢复。恢复前会自动再做一次本地快照。`,
      action: "sync-restore-latest",
      confirmText: "恢复最新备份",
      dangerous: true,
    },
  ];

  return (
    <Surface
      page={page}
      title="备份同步"
      description="备份会包含主配置、订阅、自定义分流、已解析节点和 sing-box 配置。支持 WebDAV 和 S3 兼容存储。"
      onClose={onClose}
      wide
      footer={
        <>
          <Button busy={busy} onClick={save}>保存同步设置</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <Label>
            同步方式
            <Select value={settings.provider} onValueChange={(value) => update("provider", value)} disabled={busy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webdav">WebDAV</SelectItem>
                <SelectItem value="s3">AWS S3 / S3 兼容存储</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          {settings.provider === "webdav" ? (
            <>
              <Label>
                远端目录
                <Input value={settings.webdavPath} onChange={(event) => update("webdavPath", event.target.value)} placeholder="BypassProxy" disabled={busy} />
              </Label>
              <Label className="sm:col-span-2">
                WebDAV 地址
                <Input value={settings.webdavUrl} onChange={(event) => update("webdavUrl", event.target.value)} placeholder="https://dav.example.com/dav" disabled={busy} />
              </Label>
              <Label>
                用户名
                <Input value={settings.webdavUsername} onChange={(event) => update("webdavUsername", event.target.value)} disabled={busy} />
              </Label>
              <Label>
                密码
                <Input type="password" value={webdavPassword} onChange={(event) => setWebdavPassword(event.target.value)} placeholder={settings.hasPassword ? "已保存，留空不修改" : "请输入 WebDAV 密码"} disabled={busy} />
              </Label>
            </>
          ) : (
            <>
              <Label>
                区域 (Region)
                <Input value={settings.s3Region} onChange={(event) => update("s3Region", event.target.value)} placeholder="us-east-1" disabled={busy} />
                <span className="text-xs font-normal leading-5 text-muted-foreground">AWS 示例：us-east-1、ap-northeast-1；Cloudflare R2 常用 auto。</span>
              </Label>
              <Label>
                存储桶 (Bucket)
                <Input value={settings.s3Bucket} onChange={(event) => update("s3Bucket", event.target.value)} placeholder="my-bucket" disabled={busy} />
              </Label>
              <Label>
                Access Key ID
                <Input value={settings.s3AccessKey} onChange={(event) => update("s3AccessKey", event.target.value)} disabled={busy} />
              </Label>
              <Label>
                Secret Access Key
                <Input type="password" value={s3SecretKey} onChange={(event) => setS3SecretKey(event.target.value)} placeholder={settings.hasS3SecretKey ? "已保存，留空不修改" : "请输入 Secret Key"} disabled={busy} />
              </Label>
              <Label className="sm:col-span-2">
                Endpoint（AWS 可留空）
                <Input value={settings.s3Endpoint} onChange={(event) => update("s3Endpoint", event.target.value)} placeholder="https://xxx.r2.cloudflarestorage.com" disabled={busy} />
                <span className="text-xs font-normal leading-5 text-muted-foreground">使用 AWS S3 时可以留空；多数 S3 兼容服务需要填写服务商提供的 Endpoint。</span>
              </Label>
              <Label className="sm:col-span-2">
                远程根目录
                <Input value={settings.s3Prefix} onChange={(event) => update("s3Prefix", event.target.value)} placeholder="BypassProxy" disabled={busy} />
                <span className="text-xs font-normal leading-5 text-muted-foreground">默认 BypassProxy。多个设备共用同一个远程目录时，会按时间保留多份备份。</span>
              </Label>
            </>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((item) => (
            <button
              key={item.action}
              className="grid min-h-[116px] gap-3 rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || (item.action === "sync-test" ? !canTest : item.action !== "backup-local" && !configured)}
              onClick={() => run(item.action, item.title, item.description, item.confirmText, item.dangerous, item.action === "sync-test" ? syncBody() : undefined, item.action === "sync-test")}
            >
              <div className="text-sm font-semibold">{item.title}</div>
              <p className="text-sm leading-5 text-muted-foreground">{item.description}</p>
            </button>
          ))}
        </div>

        {settings.provider === "s3" && !s3RegionReady ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Endpoint 留空时按 AWS S3 处理，Region 不能是 auto，请填写真实区域。</div> : null}
        {!configured ? <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">上传和恢复需要先保存 {providerName} 设置；测试连接可以直接使用当前填写的内容。</div> : null}
        {message ? <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</div> : null}
      </div>
    </Surface>
  );
}

function formatBytes(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatTraffic(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function subscriptionTraffic(item: Subscription) {
  const info = item.userinfo;
  const used = (info?.upload || 0) + (info?.download || 0);
  const total = info?.total || 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  const usage = total > 0 ? `${formatTraffic(used)} / ${formatTraffic(total)}` : "流量未知";
  const expiry = info?.expire ? new Date(info.expire * 1000).toISOString().slice(0, 10) : "长期有效";
  return { usage, expiry, percent };
}

function NodeCenterDialog({ onClose, panelUrl }: { onClose: () => void; panelUrl: string }) {
  const [tab, setTab] = useState<"nodes" | "connections">("nodes");
  const [proxies, setProxies] = useState<Record<string, ClashProxy>>({});
  const [selectedGroup, setSelectedGroup] = useState("");
  const [connections, setConnections] = useState<ClashConnection[]>([]);
  const [delays, setDelays] = useState<Record<string, number | null>>(storedNodeDelays);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testingGroup, setTestingGroup] = useState(false);
  const [testingNodes, setTestingNodes] = useState<string[]>([]);
  const [switching, setSwitching] = useState("");
  const [applyingGroup, setApplyingGroup] = useState(false);
  const [appliedGroup, setAppliedGroup] = useState<{ group: string; node: string } | null>(null);
  const [error, setError] = useState("");

  function isInternalGroup(name: string) {
    return new Set(["proxy", "global", "direct", "reject", "block", "auto", "自动选择"]).has(name.trim().toLowerCase());
  }

  function findGroup(next: Record<string, ClashProxy>, wanted: string) {
    const key = Object.keys(next).find((name) => name.trim().toLowerCase() === wanted);
    return key ? next[key] : undefined;
  }

  const groups = Object.entries(proxies).filter(([name, proxy]) => !isInternalGroup(name) && Array.isArray(proxy.all) && proxy.all.length > 0);
  const selectedIsGroup = groups.some(([name]) => name === selectedGroup);
  const groupProxy = proxies[selectedGroup];
  const nodeNames = groupProxy?.all || [];
  const selectedNode = groupProxy?.now || "";
  const canSelect = groupProxy?.type?.toLowerCase() === "selector";

  function effectiveGroup(next: Record<string, ClashProxy>) {
    let group = findGroup(next, "proxy")?.now || "";
    const visited = new Set<string>();
    const matchingSelector = (target: string) => Object.entries(next)
      .filter(([name, proxy]) => (
        !isInternalGroup(name)
        && proxy.type?.toLowerCase() === "selector"
        && proxy.all?.includes(target)
      ))
      .sort(([left], [right]) => {
        const leftSubscription = left.startsWith("订阅 - ") ? 0 : 1;
        const rightSubscription = right.startsWith("订阅 - ") ? 0 : 1;
        return leftSubscription - rightSubscription;
      })[0];
    while (group && next[group] && !visited.has(group)) {
      visited.add(group);
      const candidate = next[group];
      if (!isInternalGroup(group) && Array.isArray(candidate.all) && candidate.all.length > 0) return group;
      const matchingGroup = matchingSelector(group);
      if (matchingGroup) return matchingGroup[0];
      group = candidate.now || "";
    }
    const matchingGroup = matchingSelector(group);
    if (matchingGroup) return matchingGroup[0];
    return "";
  }

  const activeGroup = effectiveGroup(proxies);

  async function loadProxies() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ proxies?: Record<string, ClashProxy> }>("/api/proxies");
      const next = data.proxies || {};
      setProxies(next);
      const nextGroups = Object.entries(next).filter(([name, proxy]) => !isInternalGroup(name) && Array.isArray(proxy.all) && proxy.all.length > 0);
      setSelectedGroup((current) => {
        return effectiveGroup(next) || (current && next[current] ? current : null) || nextGroups.find(([name]) => name.startsWith("订阅 - "))?.[0] || nextGroups[0]?.[0] || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取节点失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadConnections() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ connections?: ClashConnection[] }>("/api/connections");
      setConnections(data.connections || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取连接失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProxies();
  }, []);

  async function selectNode(name: string) {
    if (!canSelect || name === selectedNode || switching) return;
    setSwitching(name);
    setError("");
    try {
      await api("/api/proxies/select", { method: "POST", body: JSON.stringify({ group: selectedGroup, name }) });
      await loadProxies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换节点失败");
    } finally {
      setSwitching("");
    }
  }

  async function applyGroup() {
    if (!selectedGroup || !groupProxy || !selectedIsGroup || applyingGroup) return;
    setApplyingGroup(true);
    setError("");
    try {
      const result = await api<{ selectedGroup?: string; selectedNode?: string }>("/api/proxies/apply-group", {
        method: "POST",
        body: JSON.stringify({ group: selectedGroup }),
      });
      setAppliedGroup({ group: result.selectedGroup || selectedGroup, node: result.selectedNode || groupProxy.now || "" });
      await loadProxies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用分组失败");
    } finally {
      setApplyingGroup(false);
    }
  }

  async function testNodes(names: string[], scope: "node" | "group" = "node") {
    if (!names.length || testing) return;
    const queue = [...new Set(names)];
    setTesting(true);
    setTestingGroup(scope === "group");
    setTestingNodes(queue);
    setError("");
    let failedRequests = 0;

    function saveDelay(name: string, delay: number | null) {
      setDelays((current) => {
        const next = { ...current, [name]: delay };
        localStorage.setItem(nodeDelayKey, JSON.stringify(next));
        return next;
      });
      setTestingNodes((current) => current.filter((item) => item !== name));
    }

    async function worker() {
      while (queue.length) {
        const name = queue.shift();
        if (!name) return;
        try {
          const result = await api<{ delays: Record<string, number | null> }>("/api/proxies/delay", {
            method: "POST",
            body: JSON.stringify({ names: [name] }),
          });
          saveDelay(name, result.delays[name] ?? null);
        } catch {
          failedRequests += 1;
          saveDelay(name, null);
        }
      }
    }

    try {
      const workerCount = Math.min(6, queue.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      if (failedRequests) setError(`${failedRequests} 个节点测速请求失败，其他节点已正常更新。`);
    } finally {
      setTesting(false);
      setTestingGroup(false);
      setTestingNodes([]);
    }
  }

  async function closeConnection(id: string) {
    try {
      await api("/api/connections/close", { method: "POST", body: JSON.stringify({ id }) });
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "关闭连接失败");
    }
  }

  async function closeAllConnections() {
    try {
      await api("/api/connections/close-all", { method: "POST", body: "{}" });
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "关闭连接失败");
    }
  }

  function shownDelay(name: string) {
    if (Object.prototype.hasOwnProperty.call(delays, name)) return delays[name];
    return undefined;
  }

  function delayColor(delay: number | null | undefined) {
    if (delay === undefined) return "text-muted-foreground";
    if (delay === null || delay > 600) return "text-destructive";
    if (delay > 300) return "text-warning";
    return "text-success";
  }

  return (
    <DialogShell
      title="节点中心"
      description="切换节点、测试延迟并管理当前连接。"
      wide
      onClose={onClose}
      footer={
        <>
          {panelUrl ? <Button variant="secondary" onClick={() => window.open(panelUrl, "_blank", "noopener,noreferrer")}><ExternalLink data-icon="inline-start" />高级面板</Button> : null}
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <Tabs>
        <TabsList className="grid-cols-2 sm:grid-cols-2">
          <TabsTrigger active={tab === "nodes"} onClick={() => { setTab("nodes"); loadProxies(); }}>节点</TabsTrigger>
          <TabsTrigger active={tab === "connections"} onClick={() => { setTab("connections"); loadConnections(); }}>连接</TabsTrigger>
        </TabsList>
        {error ? <Alert message={error} /> : null}
        <TabsContent active={tab === "nodes"}>
          <div className="flex min-w-0 items-center gap-2">
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="选择节点组" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {groups.map(([name, proxy]) => <SelectItem key={name} value={name}>{formatNodeName(name.replace(/^订阅 - /, ""))} · {proxy.all?.length || 0}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button size="sm" variant="secondary" busy={applyingGroup} disabled={applyingGroup || !selectedIsGroup} title="应用当前分组" onClick={applyGroup}>
              <Check data-icon="inline-start" />应用组
            </Button>
            <Button size="icon" variant="secondary" busy={testingGroup} disabled={testing} title="测试当前组" aria-label="测试当前组" onClick={() => testNodes(nodeNames, "group")}>
              {testingGroup ? null : <Gauge data-icon="inline-start" />}
            </Button>
            <Button size="icon" variant="secondary" title="刷新节点" aria-label="刷新节点" onClick={loadProxies}><RefreshCcw data-icon="inline-start" /></Button>
          </div>
          {appliedGroup ? <p className="text-xs text-success">已同步：{appliedGroup.group} · {appliedGroup.node} · MetaCubeXD：GLOBAL → PROXY</p> : null}
          {!canSelect && selectedGroup ? <p className="text-sm text-muted-foreground">该组由内核自动选择，可测速；请选择具体订阅组后再手动切换节点。</p> : null}
          <div className="grid gap-2">
            {nodeNames.map((name) => {
              const active = selectedGroup === activeGroup && name === selectedNode;
              const delay = shownDelay(name);
              const testingNode = testingNodes.includes(name);
              return (
                <div key={name} className={cn("flex min-w-0 items-center gap-2 rounded-lg bg-muted/45 p-1.5", active && "bg-accent")}>
                  <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start px-2 py-2" disabled={!canSelect} busy={switching === name} onClick={() => selectNode(name)}>
                    <span className="bp-node-name min-w-0 flex-1 truncate text-left">{formatNodeName(name)}</span>
                    {active ? <Badge variant="success" className="shrink-0 border-0">当前</Badge> : null}
                  </Button>
                  <Button size="sm" variant="ghost" busy={testingNode} disabled={testing} className={cn("min-w-[68px] shrink-0 font-mono text-xs", delayColor(delay))} onClick={() => testNodes([name])}>
                    {testingNode ? null : delay === null ? "超时" : delay === undefined || delay <= 0 ? "-" : `${delay} ms`}
                  </Button>
                </div>
              );
            })}
            {!loading && nodeNames.length === 0 ? <div className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">暂无可用节点</div> : null}
            {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取</div> : null}
          </div>
        </TabsContent>
        <TabsContent active={tab === "connections"}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{connections.length} 个活动连接</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={loadConnections}><RefreshCcw data-icon="inline-start" />刷新</Button>
              <Button size="sm" variant="destructive" disabled={!connections.length} onClick={closeAllConnections}>全部关闭</Button>
            </div>
          </div>
          <div className="grid gap-2">
            {connections.map((connection) => {
              const host = connection.metadata?.host || connection.metadata?.destinationIP || "未知目标";
              const port = connection.metadata?.destinationPort;
              return (
                <div key={connection.id} className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/45 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{host}{port ? `:${port}` : ""}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{connection.chains?.join(" → ") || connection.rule || connection.metadata?.network || "连接中"} · ↑ {formatBytes(connection.upload)} ↓ {formatBytes(connection.download)}</div>
                  </div>
                  <Button size="icon" variant="ghost" title="关闭连接" aria-label={`关闭 ${host} 连接`} onClick={() => closeConnection(connection.id)}><XCircle data-icon="inline-start" /></Button>
                </div>
              );
            })}
            {!loading && connections.length === 0 ? <div className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">当前没有活动连接</div> : null}
            {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取</div> : null}
          </div>
        </TabsContent>
      </Tabs>
    </DialogShell>
  );
}

function AddSubscriptionDialog({
  onClose,
  reload,
  setResult,
}: {
  onClose: () => void;
  reload: () => void;
  setResult: (result: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ ok: boolean; item: Subscription }>("/api/subscriptions", { method: "POST", body: JSON.stringify({ name, url, enabled: true }) });
      setResult(result.ok ? "已添加订阅" : "添加失败");
      reload();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="添加订阅"
      description="支持 Clash/Mihomo 订阅，也支持单条 vmess、vless、trojan、ss、hysteria2 节点。"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
          <Button busy={busy} disabled={!url.trim()} onClick={create}>添加</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Label>
          名称
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：主订阅" />
        </Label>
        <Label>
          订阅/节点地址
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://... 或 vless:// / vmess:// / trojan:// / ss://" />
        </Label>
        {error ? <Alert message={error} /> : null}
      </div>
    </DialogShell>
  );
}

function EditSubscriptionDialog({
  item,
  onClose,
  reload,
  setResult,
}: {
  item: Subscription;
  onClose: () => void;
  reload: () => void;
  setResult: (result: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [url, setUrl] = useState(item.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ ok: boolean }>(`/api/subscriptions/${item.id}`, { method: "PUT", body: JSON.stringify({ ...item, name, url }) });
      setResult(result.ok ? "已保存订阅" : "保存失败");
      reload();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="编辑订阅"
      description={`编号 ${item.id}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
          <Button busy={busy} disabled={!url.trim()} onClick={save}>保存</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Label>
          名称
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Label>
        <Label>
          订阅/节点地址
          <Input value={url} onChange={(event) => setUrl(event.target.value)} />
        </Label>
        {error ? <Alert message={error} /> : null}
      </div>
    </DialogShell>
  );
}

function SubscriptionCard({
  items,
  reload,
  setResult,
  openAction,
  openAdd,
}: {
  items: Subscription[];
  reload: () => void;
  setResult: (result: string) => void;
  openAction: (dialog: DialogState) => void;
  openAdd: () => void;
}) {
  const [editingItem, setEditingItem] = useState<Subscription | null>(null);

  async function remove(item: Subscription) {
    if (!confirm(`删除 ${item.name}？`)) return;
    await api(`/api/subscriptions/${item.id}`, { method: "DELETE" });
    setResult("已删除订阅");
    reload();
  }

  async function toggle(item: Subscription) {
    await api(`/api/subscriptions/${item.id}/toggle`, { method: "POST", body: "{}" });
    reload();
  }

  function displayHost(url: string) {
    try {
      return new URL(url).hostname;
    } catch {
      return url.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] || url;
    }
  }

  return (
    <section className="subscription-section grid gap-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="truncate text-xl font-medium sm:text-2xl">订阅与节点</h2>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => openAction({ open: true, action: "update-subscription", title: "更新订阅并应用", description: "重新拉取所有启用订阅，失败的订阅会继续使用上次成功缓存。", confirmText: "更新并应用", directChoice: true })}>
            <RefreshCcw data-icon="inline-start" />
            更新
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
        </div>
      </div>
      <div className="subscription-scroll flex min-w-0 gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
        {items.map((item) => (
          <SheetAction key={item.id} title={item.name} items={[
            { label: "编辑", icon: Pencil, onSelect: () => setEditingItem(item) },
            { label: item.enabled ? "停用" : "启用", icon: Power, onSelect: () => toggle(item) },
            { label: "删除", icon: Trash2, destructive: true, onSelect: () => remove(item) },
          ]}>
            <Card className={cn("subscription-tile w-[min(66vw,290px)] shrink-0 snap-start overflow-hidden rounded-[16px]", !item.enabled && "subscription-tile-disabled")}>
              <CardContent className="flex min-w-0 items-start gap-3 p-0">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-base font-medium">{item.name}</span>
                    <span className="subscription-id shrink-0 font-mono text-lg">#{String(item.id).padStart(3, "0")}</span>
                  </div>
                  <div className="mt-3 block min-w-0 truncate font-mono text-xs" title={item.url}>{displayHost(item.url)}</div>
                </div>
              </CardContent>
            </Card>
          </SheetAction>

        ))}        {items.length === 0 ? <Card className="lg:col-span-2"><CardContent className="p-8 text-center text-sm text-muted-foreground">暂无订阅</CardContent></Card> : null}
      </div>
      {editingItem ? <EditSubscriptionDialog item={editingItem} onClose={() => setEditingItem(null)} reload={reload} setResult={setResult} /> : null}
    </section>
  );
}

function SubscriptionManagerPage({
  items,
  reload,
  setResult,
  openAction,
  openAdd,
  onBack,
}: {
  items: Subscription[];
  reload: () => void;
  setResult: (result: string) => void;
  openAction: (dialog: DialogState) => void;
  openAdd: () => void;
  onBack: () => void;
}) {
  const [proxies, setProxies] = useState<Record<string, ClashProxy>>({});
  const [selectedGroup, setSelectedGroup] = useState("");
  const [automatic, setAutomatic] = useState(false);
  const [delays, setDelays] = useState<Record<string, number | null>>(storedNodeDelays);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testingNodes, setTestingNodes] = useState<string[]>([]);
  const [applyingGroup, setApplyingGroup] = useState("");
  const [switching, setSwitching] = useState("");
  const [error, setError] = useState("");
  const [editingItem, setEditingItem] = useState<Subscription | null>(null);
  const [nodeQuery, setNodeQuery] = useState("");
  const [nodeSort, setNodeSort] = useState<"default" | "delay" | "name">("default");

  const autoGroupName = Object.keys(proxies).find((name) => name.trim() === "自动选择") || "自动选择";
  const groupNameFor = (item: Subscription) => `订阅 - ${item.name}`;
  const selectedProxy = automatic ? proxies[autoGroupName] : proxies[selectedGroup];
  const nodeNames = selectedProxy?.all || [];
  const activeNode = selectedProxy?.now || "";
  const canSelect = !automatic && selectedProxy?.type?.toLowerCase() === "selector";
  const visibleNodeNames = nodeNames
    .filter((name) => !nodeQuery.trim() || name.toLowerCase().includes(nodeQuery.trim().toLowerCase()))
    .slice()
    .sort((left, right) => {
      if (nodeSort === "name") return left.localeCompare(right, "zh-CN");
      if (nodeSort === "delay") {
        const leftDelay = delays[left] === undefined || delays[left] === null ? Number.POSITIVE_INFINITY : delays[left];
        const rightDelay = delays[right] === undefined || delays[right] === null ? Number.POSITIVE_INFINITY : delays[right];
        return (leftDelay as number) - (rightDelay as number);
      }
      return 0;
    });

  async function loadProxies() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ proxies?: Record<string, ClashProxy> }>("/api/proxies");
      const next = data.proxies || {};
      setProxies(next);
      const available = items.map(groupNameFor).filter((name) => next[name]?.all?.length);
      setSelectedGroup((current) => current && next[current] ? current : available[0] || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取节点失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProxies();
  }, [items]);

  async function applyGroup(group: string) {
    if (!group || applyingGroup || !proxies[group]) return;
    setSelectedGroup(group);
    setAutomatic(false);
    setApplyingGroup(group);
    setError("");
    try {
      const result = await api<{ selectedGroup?: string; selectedNode?: string }>("/api/proxies/apply-group", {
        method: "POST",
        body: JSON.stringify({ group }),
      });
      setResult(`已应用${result.selectedGroup || group}：${result.selectedNode || "当前节点"}`);
      await loadProxies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用订阅失败");
    } finally {
      setApplyingGroup("");
    }
  }

  async function toggleAutomatic(next: boolean) {
    setAutomatic(next);
    if (!next || !proxies[autoGroupName]) return;
    setApplyingGroup(autoGroupName);
    setError("");
    try {
      const result = await api<{ selectedNode?: string }>("/api/proxies/apply-group", {
        method: "POST",
        body: JSON.stringify({ group: autoGroupName }),
      });
      setResult(`已启用自动选择：${result.selectedNode || "节点由内核自动选择"}`);
      await loadProxies();
    } catch (err) {
      setAutomatic(false);
      setError(err instanceof Error ? err.message : "启用自动选择失败");
    } finally {
      setApplyingGroup("");
    }
  }

  async function selectNode(name: string) {
    if (!canSelect || !selectedGroup || name === activeNode || switching) return;
    setSwitching(name);
    setError("");
    try {
      await api("/api/proxies/select", { method: "POST", body: JSON.stringify({ group: selectedGroup, name }) });
      setResult(`已切换节点：${name}`);
      await loadProxies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换节点失败");
    } finally {
      setSwitching("");
    }
  }

  async function testNodes(names: string[]) {
    if (!names.length || testing) return;
    const queue = [...new Set(names)];
    setTesting(true);
    setTestingNodes(queue);
    setError("");

    function saveDelay(name: string, delay: number | null) {
      setDelays((current) => {
        const next = { ...current, [name]: delay };
        localStorage.setItem(nodeDelayKey, JSON.stringify(next));
        return next;
      });
      setTestingNodes((current) => current.filter((item) => item !== name));
    }

    async function worker() {
      while (queue.length) {
        const name = queue.shift();
        if (!name) return;
        try {
          const result = await api<{ delays: Record<string, number | null> }>("/api/proxies/delay", {
            method: "POST",
            body: JSON.stringify({ names: [name] }),
          });
          saveDelay(name, result.delays[name] ?? null);
        } catch {
          saveDelay(name, null);
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker()));
    } finally {
      setTesting(false);
      setTestingNodes([]);
    }
  }

  async function removeSubscription(item: Subscription) {
    if (!window.confirm(`删除 ${item.name}？`)) return;
    try {
      await api(`/api/subscriptions/${item.id}`, { method: "DELETE" });
      setResult(`已删除订阅：${item.name}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除订阅失败");
    }
  }

  function delayColor(delay: number | null | undefined) {
    if (delay === undefined) return "is-muted";
    if (delay === null || delay > 600) return "is-bad";
    if (delay > 300) return "is-warn";
    return "is-good";
  }

  function nodeType(name: string) {
    const proxy = proxies[name];
    const type = proxy?.type || "代理节点";
    return `${type}${proxy?.udp ? " udp" : ""}`;
  }

  return (
    <section className="bp-subscription-page">
      <header className="bp-app-topbar bp-subscription-header">
        <Button size="icon" variant="ghost" aria-label="返回主页" title="返回主页" onClick={onBack}>
          <ArrowLeft className="size-6" strokeWidth={1.8} />
        </Button>
        <h1>订阅管理</h1>
        <SheetAction title="订阅管理" items={[
          { label: "添加订阅", icon: Plus, onSelect: openAdd },
          { label: "更新全部订阅", icon: RefreshCcw, onSelect: () => openAction({ open: true, action: "update-subscription", title: "更新订阅并应用", description: "重新拉取所有启用订阅，失败的订阅会继续使用上次成功缓存。", confirmText: "更新并应用", directChoice: true }) },
          { label: "刷新节点列表", icon: Gauge, onSelect: () => { void loadProxies(); } },
        ]}>
          <Button size="icon" variant="ghost" aria-label="订阅管理菜单" title="订阅管理菜单">
            <MoreVertical className="size-6" strokeWidth={1.8} />
          </Button>
        </SheetAction>
      </header>

      {error ? <Alert message={error} /> : null}

      <div className="bp-subscription-plans subscription-scroll flex min-w-0 gap-4 overflow-x-auto px-4 pb-2 snap-x snap-mandatory sm:px-0">
        {items.map((item) => {
          const group = groupNameFor(item);
          const active = !automatic && selectedGroup === group;
          const traffic = subscriptionTraffic(item);
          return (
            <Card
              key={item.id}
              className={cn("bp-subscription-plan snap-start", active && "is-active", !item.enabled && "is-disabled", applyingGroup === group && "is-loading")}
              role="button"
              tabIndex={item.enabled ? 0 : -1}
              aria-disabled={!item.enabled}
              onClick={() => item.enabled && void applyGroup(group)}
              onKeyDown={(event) => {
                if (item.enabled && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  void applyGroup(group);
                }
              }}
            >
              <CardContent className="flex min-h-[160px] flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-bold leading-none">{item.name}</h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="ghost" className="bp-subscription-card-action" aria-label={`刷新${item.name}`} title={`刷新${item.name}`} onClick={(event) => { event.stopPropagation(); openAction({ open: true, action: "update-subscription", title: "更新订阅并应用", description: `更新${item.name}及其他启用订阅。`, confirmText: "更新并应用", directChoice: true }); }}>
                      <RefreshCcw className="size-3.5" />
                    </Button>
                    <SheetAction title={item.name} items={[
                      { label: "编辑", icon: Pencil, onSelect: () => setEditingItem(item) },
                      { label: item.enabled ? "停用" : "启用", icon: Power, onSelect: () => { void api(`/api/subscriptions/${item.id}/toggle`, { method: "POST", body: "{}" }).then(reload); } },
                      { label: "删除", icon: Trash2, destructive: true, onSelect: () => { void removeSubscription(item); } },
                    ]}>
                      <Button size="icon" variant="ghost" className="bp-subscription-card-action" aria-label={`${item.name}更多操作`} title="更多操作" onClick={(event) => event.stopPropagation()}>
                        <MoreVertical className="size-3.5" />
                      </Button>
                    </SheetAction>
                  </div>
                </div>
                <div className="mt-auto grid gap-1.5">
                  <div className="flex items-end justify-between gap-4">
                    <p className="truncate text-xs">{traffic.usage}</p>
                    <p className="max-w-[52%] truncate text-right text-xs opacity-55">{item.enabled ? traffic.expiry : "不可用"}</p>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/20"><div className="h-full rounded-full bg-black/25 transition-all" style={{ width: `${traffic.percent}%` }} /></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!items.length ? <Card className="min-w-full"><CardContent className="p-8 text-center text-sm text-muted-foreground">暂无订阅</CardContent></Card> : null}
      </div>

      <div className="bp-subscription-nodes px-1.5">
        <div className="bp-node-toolbar">
          <div className="bp-subscription-auto flex items-center gap-2">
            <span>自动选择</span>
            <Switch pressed={automatic} onPressedChange={(pressed) => void toggleAutomatic(pressed)} disabled={Boolean(applyingGroup)} aria-label="自动选择节点" />
            {applyingGroup === autoGroupName ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
          </div>
          <Button size="icon" variant="ghost" busy={testing} disabled={!nodeNames.length || testing} title="测试当前节点延迟" aria-label="测试当前节点延迟" onClick={() => void testNodes(nodeNames)}>
            {testing ? null : <Gauge className="size-5" />}
          </Button>
        </div>
        <div className="bp-node-filters">
          <Input value={nodeQuery} onChange={(event) => setNodeQuery(event.target.value)} placeholder="筛选节点" aria-label="筛选节点" />
          <Select value={nodeSort} onValueChange={(value) => setNodeSort(value as typeof nodeSort)}>
            <SelectTrigger className="min-w-0" aria-label="节点排序"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认排序</SelectItem>
              <SelectItem value="delay">延迟从低到高</SelectItem>
              <SelectItem value="name">名称排序</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          {visibleNodeNames.map((name) => {
            const active = name === activeNode && !automatic;
            const delay = Object.prototype.hasOwnProperty.call(delays, name) ? delays[name] : undefined;
            const testingNode = testingNodes.includes(name);
            return (
              <button key={name} type="button" className={cn("bp-node-card", active && "is-active", !canSelect && "is-auto")} disabled={!canSelect || switching === name} onClick={() => void selectNode(name)}>
                <span className="min-w-0 flex-1 text-left">
                  <span className="bp-node-name block truncate text-[14px] leading-6">{formatNodeName(name)}</span>
                  <span className="mt-1 block text-xs text-white/35">{nodeType(name)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {active ? <Badge variant="success" className="border-0 text-sm">当前</Badge> : null}
                  <span className={cn("bp-node-delay text-sm", delayColor(delay))}>{testingNode ? <Loader2 className="size-4 animate-spin" /> : delay === null ? "超时" : delay === undefined || delay <= 0 ? "-" : `${delay} ms`}</span>
                </span>
              </button>
            );
          })}
          {!loading && !nodeNames.length ? <div className="rounded-2xl bg-muted/50 p-8 text-center text-sm text-muted-foreground">暂无可用节点</div> : null}
          {loading && !nodeNames.length ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" />正在读取节点</div> : null}
          {!loading && nodeNames.length > 0 && !visibleNodeNames.length ? <div className="rounded-2xl bg-muted/50 p-8 text-center text-sm text-muted-foreground">没有匹配的节点</div> : null}
        </div>
      </div>
      {editingItem ? <EditSubscriptionDialog item={editingItem} onClose={() => setEditingItem(null)} reload={reload} setResult={setResult} /> : null}
    </section>
  );
}

function HomeSummary({
  status,
  subscriptions,
  openNodes,
  openSubscriptions,
  openAction,
}: {
  status: Status | null;
  subscriptions: Subscription[];
  openNodes: () => void;
  openSubscriptions: () => void;
  openAction: (dialog: DialogState) => void;
}) {
  const stats = [
    { label: "代理内核", value: status?.kernel || status?.services.kernel || "读取中" },
    { label: "代理模式", value: status?.proxyMode === "global" ? "全局" : status?.proxyMode === "direct" ? "直连" : "规则" },
    { label: "节点", value: `${status?.nodeCount ?? 0}` },
    { label: "订阅", value: `${subscriptions.length}` },
  ];
  return (
    <section className="bp-home-summary">
      <div className="bp-home-summary-heading">
        <h2>运行概览</h2>
        <span>状态自动刷新</span>
      </div>
      <div className="bp-home-stats">
        {stats.map((item) => (
          <div key={item.label} className="bp-home-stat">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="bp-home-actions" aria-label="常用操作">
        <FunctionTile title="节点中心" icon={PanelTop} onClick={openNodes} />
        <FunctionTile title="订阅管理" icon={Send} onClick={openSubscriptions} />
        <FunctionTile title="网络诊断" icon={Bug} onClick={() => openAction({ open: true, action: "diagnose-network", title: "网络诊断", description: "检查服务、DNS、转发、订阅节点等常见问题。", confirmText: "开始诊断" })} />
        <FunctionTile title="一键修复" icon={Wrench} onClick={() => openAction({ open: true, action: "repair", title: "一键修复", description: "修复配置、服务和转发状态。", confirmText: "开始修复" })} />
      </div>
    </section>
  );
}

type AppTab = "home" | "subscriptions" | "settings";
type AppRoute = AppTab | "basic-settings" | "password" | "custom-rules" | "sync";

const appRoutes: AppRoute[] = ["home", "subscriptions", "settings", "basic-settings", "password", "custom-rules", "sync"];

function routeFromLocation(): AppRoute {
  const value = new URLSearchParams(window.location.search).get("route");
  return value && appRoutes.includes(value as AppRoute) ? value as AppRoute : "home";
}

function urlForRoute(route: AppRoute) {
  const url = new URL(window.location.href);
  if (route === "home") url.searchParams.delete("route");
  else url.searchParams.set("route", route);
  return `${url.pathname}${url.search}${url.hash}`;
}

function BottomTabBar({ activeTab, onChange }: { activeTab: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: Array<{ value: AppTab; label: string; icon: LucideIcon }> = [
    { value: "home", label: "主页", icon: Home },
    { value: "subscriptions", label: "订阅", icon: Send },
    { value: "settings", label: "设置", icon: Settings },
  ];

  return (
    <nav className="bp-tabbar" aria-label="主导航">
      <div className="bp-tabbar-inner" role="tablist">
        {tabs.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            role="tab"
            aria-selected={activeTab === value}
            className={cn("bp-tabbar-item", activeTab === value && "is-active")}
            onClick={() => onChange(value)}
          >
            <Icon className="size-4" strokeWidth={activeTab === value ? 2.4 : 1.8} />
            <span>{label}</span>
          </Button>
        ))}
      </div>
    </nav>
  );
}

function App() {
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem(tokenKey)));
  const [status, setStatus] = useState<Status | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ open: false, action: "", title: "", description: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [nodesOpen, setNodesOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());
  const [busyAction, setBusyAction] = useState("");
  const [dialogOutput, setDialogOutput] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [lastResult, setLastResult] = useState("");
  const [error, setError] = useState("");
  const [modeBusy, setModeBusy] = useState(false);

  function navigate(next: AppRoute, replace = false) {
    if (next === route) return;
    const url = urlForRoute(next);
    window.history[replace ? "replaceState" : "pushState"]({ bypassproxyRoute: next }, "", url);
    setRoute(next);
  }

  async function loadAll() {
    if (!loggedIn) return;
    try {
      const [nextStatus, subs] = await Promise.all([api<Status>("/api/status"), api<{ items: Subscription[] }>("/api/subscriptions")]);
      setStatus(nextStatus);
      setSubscriptions(subs.items);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
      if ((err instanceof Error ? err.message : "").includes("密钥")) setLoggedIn(false);
    }
  }

  function openAction(next: DialogState) {
    setDialog(next);
    setDialogOutput("");
    setDialogError("");
  }

  async function changeProxyMode(mode: ProxyMode) {
    if (modeBusy || mode === status?.proxyMode) return;
    setModeBusy(true);
    setError("");
    try {
      const result = await api<{ ok: boolean; proxyMode: ProxyMode }>("/api/proxy-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      setStatus((current) => current ? { ...current, proxyMode: result.proxyMode } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "模式切换失败");
    } finally {
      setModeBusy(false);
    }
  }

  async function confirmAction() {
    const current = dialog;
    setBusyAction(current.action);
    setDialogOutput("");
    setDialogError("");
    let fullOutput = "";
    try {
      const body = { ...(current.body || {}) };
      if (current.directChoice !== undefined) body.direct = current.directChoice;
      const response = await fetch(`/api/actions-stream/${current.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "操作失败");
      }
      if (!response.body) throw new Error("浏览器不支持实时输出");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullOutput += chunk;
        setDialogOutput((currentOutput) => currentOutput + chunk);
      }
      const tail = fullOutput.trim().slice(-1200) || "完成";
      setLastResult(tail);
      if (!fullOutput.includes("DONE code=0")) {
        setDialogError("执行没有完整成功，请查看上面的输出。");
      }
      await loadAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      setDialogError(message);
      setLastResult(fullOutput.trim() || message);
    } finally {
      setBusyAction("");
    }
  }

  useEffect(() => {
    function handlePopState() {
      setRoute(routeFromLocation());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    loadAll();
    const timer = window.setInterval(loadAll, 12000);
    return () => window.clearInterval(timer);
  }, [loggedIn]);

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const rootTab: AppTab = route === "subscriptions"
    ? "subscriptions"
    : route === "settings" || ["basic-settings", "password", "custom-rules", "sync"].includes(route)
      ? "settings"
      : "home";

  return (
    <main className="min-h-screen bg-background pb-28 sm:pb-10">
      <div className="mx-auto grid w-full max-w-[1120px] gap-12 px-4 sm:gap-14 sm:px-6 lg:px-8">
        <div className={cn("min-w-0", rootTab !== "home" && "hidden")}>
          <section className="-mx-4 flex min-h-0 flex-col overflow-hidden rounded-b-[20px] bg-[linear-gradient(180deg,#5f5f5f,#2d2d2d)] lg:-mx-8 sm:-mx-6">
            <HeaderPanel
              proxyMode={status?.proxyMode || "rule"}
              modeBusy={modeBusy}
              onModeChange={changeProxyMode}
            />
            <LegacyNetworkOverviewV2 status={status} openAction={openAction} />
          </section>
          <HomeSummary status={status} subscriptions={subscriptions} openNodes={() => setNodesOpen(true)} openSubscriptions={() => navigate("subscriptions")} openAction={openAction} />
        </div>

        {error ? <Alert message={error} /> : null}
        <div className={cn("min-w-0", rootTab !== "subscriptions" && "hidden")}>
          <SubscriptionManagerPage items={subscriptions} reload={loadAll} setResult={setLastResult} openAction={openAction} openAdd={() => setAddOpen(true)} onBack={() => navigate("home", true)} />
        </div>
        <div className={cn("min-w-0", rootTab !== "settings" && "hidden")}>
          <ControlCenter status={status} openAction={openAction} openPassword={() => navigate("password")} openBasicSettings={() => navigate("basic-settings")} openNodes={() => setNodesOpen(true)} openCustomRules={() => navigate("custom-rules")} openSync={() => navigate("sync")} showRecent={() => setRecentOpen(true)} />
        </div>
        {route === "basic-settings" ? <BasicSettingsDialog page onClose={() => navigate("settings", true)} setResult={setLastResult} /> : null}
        {route === "password" ? <PasswordDialog page onClose={() => navigate("settings", true)} onPasswordChanged={() => setLoggedIn(false)} /> : null}
        {route === "custom-rules" ? <CustomRulesDialog page onClose={() => navigate("settings", true)} setResult={setLastResult} openAction={openAction} /> : null}
        {route === "sync" ? <BackupSyncDialog page onClose={() => navigate("settings", true)} openAction={openAction} setResult={setLastResult} /> : null}
      </div>
      <BottomTabBar activeTab={rootTab} onChange={(next) => navigate(next)} />
      {addOpen ? <AddSubscriptionDialog onClose={() => setAddOpen(false)} reload={loadAll} setResult={setLastResult} /> : null}
      {nodesOpen ? <NodeCenterDialog onClose={() => setNodesOpen(false)} panelUrl={status?.addresses.panel || ""} /> : null}
      {recentOpen ? <TextDialog title="最近结果" content={lastResult} onClose={() => setRecentOpen(false)} /> : null}
      <ActionDialog dialog={dialog} setDialog={setDialog} running={Boolean(busyAction)} output={dialogOutput} error={dialogError} onConfirm={confirmAction} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
