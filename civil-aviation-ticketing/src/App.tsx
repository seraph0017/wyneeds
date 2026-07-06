import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookingRequest, CabinClass, City, Flight, OrderRecord, PassengerInput } from './domain/types';
import { baggageNotes, baggageRules, changeRules, refundNotes, refundRules, ruleReference, specialPassengerRules } from './data/rules';
import { validateContact, validateFlightSearch, validateOrderRequest, validatePassenger } from './domain/validation';
import { calculatePassengerFare, cabinName } from './domain/pricing';

type SortKey = 'timeAsc' | 'timeDesc' | 'priceAsc' | 'priceDesc' | 'duration';
type Step = 'search' | 'flights' | 'booking' | 'success' | 'orders' | 'rules';

type LicenseFeature = 'ticketing' | 'training' | 'desktop';

interface LicenseSummary {
  licenseId: string;
  customerName: string;
  expiresAt: string;
  features: LicenseFeature[];
  deviceHash: string;
  deviceDisplayCode: string;
  offlineGraceDays: number;
}

interface LicenseStatusResponse {
  licensed: boolean;
  reason?: string;
  message?: string;
  deviceHash: string;
  deviceDisplayCode: string;
  summary?: LicenseSummary;
  activationRequired: boolean;
  activationServerConfigured: boolean;
  remoteReused?: boolean;
}

const launchParams = new URLSearchParams(window.location.search);
const apiPort = launchParams.get('apiPort');
const apiToken = launchParams.get('apiToken');
const apiBase = apiPort ? `http://127.0.0.1:${apiPort}` : '';
const today = new Date().toISOString().slice(0, 10);
const cabinOrder: CabinClass[] = ['economy', 'business', 'first'];
const quickTestRoutes = [
  { label: '北京大兴 → 广州', fromCityCode: 'PKX', toCityCode: 'CAN' },
  { label: '上海浦东 → 东京成田', fromCityCode: 'PVG', toCityCode: 'NRT' },
  { label: '昆明 → 西双版纳', fromCityCode: 'KMG', toCityCode: 'JHG' },
  { label: '上海浦东 → 伦敦', fromCityCode: 'PVG', toCityCode: 'LHR' },
  { label: '广州 → 曼谷', fromCityCode: 'CAN', toCityCode: 'BKK' },
];

function minutesText(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}小时${m}分`;
}

function formatCity(city?: City) {
  return city ? `${city.name} / ${city.code} / ${city.airport}` : '';
}

function parseCityCode(value: string, cities: City[]): string | undefined {
  const trimmed = value.trim();
  const exact = cities.find((city) => formatCity(city) === trimmed || city.code === trimmed.toUpperCase() || city.name === trimmed || city.airport === trimmed);
  if (exact) return exact.code;
  const codeMatch = trimmed.match(/\/\s*([A-Z]{3})\s*\//i);
  if (codeMatch) return codeMatch[1].toUpperCase();
  if (/^[a-z]+$/i.test(trimmed) && trimmed.length < 3) return undefined;
  if (trimmed.length < 2) return undefined;
  const fuzzy = cities.find((city) => `${city.name}${city.code}${city.airport}${city.province}`.toLowerCase().includes(trimmed.toLowerCase()));
  return fuzzy?.code;
}

function emptyPassenger(type: PassengerInput['type'], index: number, adultId?: string): PassengerInput {
  const id = `${type}-${index}-${Date.now()}`;
  const common = {
    id,
    type,
    name: '',
    gender: '男' as const,
    birthDate: type === 'adult' ? '1990-01-01' : type === 'infant' ? '2025-01-01' : '2018-01-01',
    documentType: type === 'adult' ? '身份证' as const : '户口簿' as const,
    documentNumber: type === 'adult' ? '110101199001011234' : `户口簿${index}号`,
    documentExpiry: '2032-12-31',
    phone: '13800138000',
    linkedAdultId: adultId,
  } satisfies PassengerInput;
  if (type === 'um') {
    return {
      ...common,
      sender: { name: '送机人', phone: '13700137000', documentNumber: '110101198001011234' },
      receiver: { name: '接机人', phone: '13600136000', relationship: '父母' },
    };
  }
  return common;
}

function passengerTypeName(type: PassengerInput['type']) {
  return type === 'adult' ? '成人' : type === 'child' ? '儿童' : type === 'infant' ? '婴儿' : '无成人陪伴儿童';
}

function documentOptionsForType(type: PassengerInput['type']) {
  return type === 'adult' ? ['身份证', '护照', '港澳通行证', '台胞证'] : ['身份证', '护照', '户口簿'];
}

function fieldError(errors: string[], words: string[]) {
  return errors.find((error) => words.some((word) => error.includes(word)));
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: apiToken ? { 'X-CA-Session': apiToken } : undefined });
  if (!res.ok) throw new Error(`请求失败：${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-CA-Session': apiToken } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { message?: string; errors?: string[] }).message ?? (data as { errors?: string[] }).errors?.join('；') ?? `请求失败：${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

function CitySearchInput({ label, value, cities, onChange, error }: { label: string; value: string; cities: City[]; onChange: (code: string) => void; error?: string }) {
  const selected = cities.find((city) => city.code === value);
  const [query, setQuery] = useState(formatCity(selected));
  const inputRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);
  const listId = `${label}-city-list`;

  useEffect(() => {
    if (editingRef.current) return;
    setQuery(formatCity(selected));
  }, [selected?.code]);

  const pick = (nextValue: string) => {
    setQuery(nextValue);
    const code = parseCityCode(nextValue, cities);
    onChange(code ?? '');
  };

  return (
    <label className={error ? 'field has-error' : 'field'}>
      {label}
      <span className="city-input-row">
        <input
          ref={inputRef}
          list={listId}
          value={query}
          onFocus={(event) => {
            editingRef.current = true;
            event.currentTarget.select();
          }}
          onChange={(event) => pick(event.target.value)}
          onBlur={() => {
            editingRef.current = false;
            const code = parseCityCode(query, cities);
            if (code) {
              const city = cities.find((item) => item.code === code);
              setQuery(formatCity(city));
              onChange(code);
            } else {
              setQuery('');
              onChange('');
            }
          }}
          placeholder="输入城市、三字码或机场名搜索"
          aria-invalid={Boolean(error)}
        />
        <button
          type="button"
          className="city-change-button"
          aria-label={`更换${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editingRef.current = true;
            setQuery('');
            onChange('');
            inputRef.current?.focus();
          }}
        >
          换
        </button>
      </span>
      <datalist id={listId}>
        {cities.map((city) => <option key={city.code} value={formatCity(city)} />)}
      </datalist>
      {error ? <small className="field-error">{error}</small> : <small className="field-help">点输入框可直接覆盖；也可点“换”后输入城市名/三字码</small>}
    </label>
  );
}

function FieldHint({ error, help }: { error?: string; help?: string }) {
  if (error) return <small className="field-error">{error}</small>;
  if (help) return <small className="field-help">{help}</small>;
  return null;
}

function LicenseGate({ status, busy, onActivate }: { status: LicenseStatusResponse | null; busy: boolean; onActivate: (inviteCode: string) => Promise<void> }) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await onActivate(inviteCode);
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : '激活失败，请稍后重试');
    }
  }

  return (
    <main className="app-shell license-shell">
      <section className="license-card" aria-labelledby="license-title">
        <div className="license-mark">CA</div>
        <div className="license-copy">
          <p className="eyebrow">ToB 授权激活</p>
          <h1 id="license-title">民航客票销售订座系统</h1>
          <p>首次使用需要联网输入邀请码完成设备绑定。激活后授权文件保存在本机，后续可尽量离线使用。</p>
        </div>

        <div className="license-status-grid">
          <div><span>本机设备码</span><b>{status?.deviceDisplayCode ?? '读取中...'}</b></div>
          <div><span>授权状态</span><b>{status?.licensed ? '已授权' : '待激活'}</b></div>
          <div><span>授权服务器</span><b>{status?.activationServerConfigured ? '已配置' : '未配置'}</b></div>
        </div>

        {status?.message && <div className="license-warning" role="status">{status.message}</div>}
        {!status?.activationServerConfigured && <div className="license-warning" role="status">当前未配置授权服务器地址。部署正式域名后设置 CA_LICENSE_SERVER_URL，或在 exe 同目录放置 license-config.json，即可使用邀请码在线激活。</div>}

        <form className="license-form" onSubmit={submit}>
          <label className="field">授权邀请码
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="例如 WY-2026-ABCD-EFGH" autoFocus aria-describedby="license-help" />
          </label>
          <small id="license-help" className="field-help">邀请码由供应商后台生成，可限制客户、有效期和可绑定设备数。</small>
          {error && <div className="error-list" role="alert"><p>{error}</p></div>}
          <button className="primary full" type="submit" disabled={busy || !inviteCode.trim() || !status?.activationServerConfigured}>
            {busy ? '正在激活...' : '激活并进入系统'}
          </button>
        </form>

        <div className="license-footnote">
          <b>说明</b>：本软件是教学/实训模拟版，不连接真实航司、真实支付或真实票务。复制 exe 到其他电脑后仍需重新授权。
        </div>
      </section>
    </main>
  );
}

function App() {
  const [cities, setCities] = useState<City[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [rules, setRules] = useState({ baggageRules, baggageNotes, refundRules, refundNotes, changeRules, specialPassengerRules, ruleReference });
  const [step, setStep] = useState<Step>('search');
  const [sort, setSort] = useState<SortKey>('timeAsc');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState({ fromCityCode: 'PKX', toCityCode: 'CAN', flightDate: today, adults: 1, children: 0, infants: 0 });
  const [selected, setSelected] = useState<{ flight: Flight; cabinClass: CabinClass; fare: number; remainingSeats: number } | null>(null);
  const [passengers, setPassengers] = useState<PassengerInput[]>([emptyPassenger('adult', 1)]);
  const [contact, setContact] = useState({ name: '订票老师', phone: '13900139000', email: 'teacher@example.com' });
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusResponse | null>(null);
  const [licenseChecking, setLicenseChecking] = useState(true);
  const [licenseBusy, setLicenseBusy] = useState(false);

  useEffect(() => {
    refreshLicenseStatus();
  }, []);

  useEffect(() => {
    if (licenseStatus?.licensed) loadInitialData();
  }, [licenseStatus?.licensed]);

  async function refreshLicenseStatus() {
    setLicenseChecking(true);
    try {
      setLicenseStatus(await getJson<LicenseStatusResponse>(`${apiBase}/api/license/status`));
    } catch {
      setLicenseStatus({
        licensed: false,
        activationRequired: true,
        activationServerConfigured: false,
        deviceHash: '',
        deviceDisplayCode: 'UNKNOWN',
        message: '授权状态读取失败，请重启软件或联系供应商',
      });
    } finally {
      setLicenseChecking(false);
    }
  }

  async function activateLicense(inviteCode: string) {
    setLicenseBusy(true);
    try {
      const result = await postJson<LicenseStatusResponse>(`${apiBase}/api/license/activate`, { inviteCode });
      if (!result.licensed) throw new Error(result.message || '激活失败');
      setLicenseStatus(result);
      setNotice(`授权成功：${result.summary?.customerName ?? '授权客户'}，有效期至 ${result.summary?.expiresAt ?? '授权到期日'}`);
    } finally {
      setLicenseBusy(false);
    }
  }

  async function loadInitialData() {
    setCitiesLoading(true);
    getJson<City[]>(`${apiBase}/api/cities`)
      .then(setCities)
      .catch(() => setNotice('城市数据加载失败'))
      .finally(() => setCitiesLoading(false));
    getJson<typeof rules>(`${apiBase}/api/rules`).then(setRules).catch(() => undefined);
    refreshOrders();
  }

  async function refreshOrders() {
    try { setOrders(await getJson<OrderRecord[]>(`${apiBase}/api/orders`)); } catch { setOrders([]); }
  }

  const cityMap = useMemo(() => new Map(cities.map((city) => [city.code, city])), [cities]);
  const searchErrors = validateFlightSearch(search);
  const sortedFlights = useMemo(() => {
    const copy = [...flights];
    const economyFare = (flight: Flight) => flight.cabins.find((cabin) => cabin.class === 'economy')?.fare ?? 0;
    return copy.sort((a, b) => {
      if (sort === 'timeAsc') return a.departureTime.localeCompare(b.departureTime);
      if (sort === 'timeDesc') return b.departureTime.localeCompare(a.departureTime);
      if (sort === 'priceAsc') return economyFare(a) - economyFare(b);
      if (sort === 'priceDesc') return economyFare(b) - economyFare(a);
      return a.durationMinutes - b.durationMinutes;
    });
  }, [flights, sort]);

  function syncPassengers(nextSearch = search) {
    const adults = Array.from({ length: nextSearch.adults }, (_, i) => emptyPassenger('adult', i + 1));
    const adultId = adults[0]?.id;
    const children = Array.from({ length: nextSearch.children }, (_, i) => emptyPassenger('child', i + 1, adultId));
    const infants = Array.from({ length: nextSearch.infants }, (_, i) => emptyPassenger('infant', i + 1, adultId));
    setPassengers([...adults, ...children, ...infants]);
  }

  function updateSearch(partial: Partial<typeof search>) {
    const next = { ...search, ...partial };
    setSearch(next);
    if ('adults' in partial || 'children' in partial || 'infants' in partial) syncPassengers(next);
  }

  async function submitSearch() {
    const errors = validateFlightSearch(search);
    if (errors.length) return setNotice(errors.join('；'));
    setLoading(true);
    setNotice('正在查询航班...');
    try {
      const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(search).map(([k, v]) => [k, String(v)])) });
      const data = await getJson<Flight[]>(`${apiBase}/api/flights?${params}`);
      setFlights(data);
      setStep('flights');
      setNotice(data.length ? `找到 ${data.length} 个模拟航班` : '暂无符合条件的航班，请调整查询条件');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '航班查询失败');
    } finally {
      setLoading(false);
    }
  }

  function beginBooking(flight: Flight, cabinClass: CabinClass) {
    const cabin = flight.cabins.find((item) => item.class === cabinClass)!;
    setSelected({ flight, cabinClass, fare: cabin.fare, remainingSeats: cabin.remainingSeats });
    syncPassengers();
    setStep('booking');
    setNotice('请填写乘机人和联系人信息');
  }

  function updatePassenger(index: number, patch: Partial<PassengerInput>) {
    setPassengers((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function addUmPassenger() {
    setPassengers((items) => [...items, emptyPassenger('um', items.length + 1)]);
  }

  function bookingRequest(): BookingRequest | null {
    if (!selected) return null;
    const fromCity = cityMap.get(selected.flight.fromCityCode);
    const toCity = cityMap.get(selected.flight.toCityCode);
    return {
      flightId: selected.flight.id,
      flightDate: search.flightDate,
      cabinClass: selected.cabinClass,
      cabinRemainingSeats: selected.remainingSeats,
      baseFare: selected.fare,
      route: `${fromCity?.name ?? selected.flight.fromCityCode} · ${selected.flight.fromAirport} → ${toCity?.name ?? selected.flight.toCityCode} · ${selected.flight.toAirport}`,
      flightSnapshot: {
        flightNo: selected.flight.flightNo,
        airline: selected.flight.airline,
        aircraft: selected.flight.aircraft,
        fromAirport: selected.flight.fromAirport,
        toAirport: selected.flight.toAirport,
        departureTime: selected.flight.departureTime,
        arrivalTime: selected.flight.arrivalTime,
        arrivalNextDay: selected.flight.arrivalNextDay,
        durationMinutes: selected.flight.durationMinutes,
      },
      passengers,
      contact,
    };
  }

  async function submitOrder() {
    const request = bookingRequest();
    if (!request) return;
    const errors = validateOrderRequest(request);
    if (errors.length) return setNotice(errors.join('；'));
    if (!window.confirm(`确认生成模拟订单并出票？\n航班：${request.flightSnapshot?.flightNo ?? request.flightId}\n人数：${request.passengers.length}\n金额：¥${totalAmount}`)) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-CA-Session': apiToken } : {}) }, body: JSON.stringify(request) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join('；') ?? '订单提交失败');
      setLastOrder(data);
      setStep('success');
      setNotice('订单已生成，电子客票和行程单可打印/保存');
      refreshOrders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '订单提交失败');
    } finally { setLoading(false); }
  }

  async function chooseChangeTarget(order: OrderRecord): Promise<string | null> {
    try {
      const currentFlight = await getJson<Flight>(`${apiBase}/api/flights/${order.flightId}`);
      const params = new URLSearchParams({
        fromCityCode: currentFlight.fromCityCode,
        toCityCode: currentFlight.toCityCode,
        flightDate: order.flightDate,
        adults: '1',
        children: '0',
        infants: '0',
      });
      const candidates = (await getJson<Flight[]>(`${apiBase}/api/flights?${params}`))
        .filter((flight) => flight.id !== order.flightId && (flight.cabins.find((cabin) => cabin.class === order.cabinClass)?.remainingSeats ?? 0) >= order.passengers.length);
      if (candidates.length === 0) {
        setNotice('暂无同航线且余票足够的可改签航班');
        return null;
      }
      const optionText = candidates.map((flight, index) => {
        const cabin = flight.cabins.find((item) => item.class === order.cabinClass);
        return `${index + 1}. ${flight.flightNo} ${flight.departureTime}-${flight.arrivalTime} ${flight.airline} ${cabinName(order.cabinClass)} ¥${cabin?.fare ?? 0} 余${cabin?.remainingSeats ?? 0}`;
      }).join('\n');
      const choice = window.prompt(`请选择同航线改签航班，输入序号：\n${optionText}`, '1');
      if (!choice) return null;
      const index = Number(choice) - 1;
      return candidates[index]?.id ?? null;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '改签航班加载失败');
      return null;
    }
  }

  async function mutateOrder(order: OrderRecord, action: 'cancel' | 'refund' | 'change') {
    let body: Record<string, unknown> = {};
    let context = '';
    if (action === 'refund') {
      const afterDeparture = window.confirm('是否按“航班起飞后”规则计算退票手续费？\n选择“取消”则按起飞前规则计算。');
      body = { afterDeparture };
      context = afterDeparture ? '\n将按起飞后规则计算手续费。' : '\n将按起飞前规则计算手续费。';
    }
    if (action === 'change') {
      const targetFlightId = await chooseChangeTarget(order);
      if (!targetFlightId) return;
      body = { targetFlightId, sameCabin: true };
      context = `\n目标航班：${targetFlightId}`;
    }
    const actionName = action === 'cancel' ? '取消' : action === 'refund' ? '退票' : '改签';
    if (!window.confirm(`确认${actionName}订单 ${order.orderNo}？\n当前状态：${order.status}\n订单金额：¥${order.totalAmount}${context}`)) return;
    setLoading(true);
    setNotice(`正在处理${actionName}...`);
    try {
      const res = await fetch(`${apiBase}/api/orders/${order.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-CA-Session': apiToken } : {}) }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join('；') ?? `${actionName}失败`);
      setNotice(`${actionName}处理完成`);
      await refreshOrders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${actionName}失败`);
    } finally {
      setLoading(false);
    }
  }

  const request = bookingRequest();
  const requestErrors = request ? validateOrderRequest(request) : [];
  const contactErrors = validateContact(contact);
  const totalAmount = request ? passengers.reduce((sum, item) => sum + calculatePassengerFare(request.baseFare, item.type), 0) : 0;

  if (licenseChecking) {
    return <main className="app-shell license-shell"><section className="license-card"><div className="skeleton-block">正在校验本机授权...</div></section></main>;
  }

  if (!licenseStatus?.licensed) {
    return <LicenseGate status={licenseStatus} busy={licenseBusy} onActivate={activateLicense} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span>CA</span><div><strong>民航客票销售订座系统</strong><small>教学/实训模拟 · Web + 桌面版</small></div></div>
        <nav>
          <button onClick={() => setStep('search')} className={step === 'search' ? 'active' : ''} aria-current={step === 'search' ? 'page' : undefined}>查询订票</button>
          <button onClick={() => { refreshOrders(); setStep('orders'); }} className={step === 'orders' ? 'active' : ''} aria-current={step === 'orders' ? 'page' : undefined}>订单管理</button>
          <button onClick={() => setStep('rules')} className={step === 'rules' ? 'active' : ''} aria-current={step === 'rules' ? 'page' : undefined}>运输规则</button>
        </nav>
      </header>

      <section className="hero-panel">
        <div>
          <h1>国内/境外航班查询、订座、出票一体化实训</h1>
          <p>覆盖国内主流机场、港澳台及境外常用机场三字码，内置舱位余票、退改签、行李规则与电子客票行程单。</p>
        </div>
        <div className="hero-card"><b>基础订票 / 规则学习 / 退改签模拟</b><span>首页查询 · 航班列表 · 订单确认 · 电子客票 · 退改签模拟</span></div>
      </section>

      {notice && <div className={`notice ${loading ? 'loading' : ''}`} role={loading ? 'status' : 'alert'} aria-live="polite">{notice}</div>}

      {step === 'search' && (
        <section className="panel search-panel">
          <div className="section-title"><h2>航班查询</h2><p>出发城市、到达城市、日期和旅客人数为必填项；可直接输入城市名、机场名或 IATA 三字码。</p></div>
          {citiesLoading ? <div className="skeleton-block">正在加载城市和机场数据...</div> : <div className="search-grid">
            <CitySearchInput label="出发城市" value={search.fromCityCode} cities={cities} onChange={(code) => updateSearch({ fromCityCode: code })} error={fieldError(searchErrors, ['出发城市'])} />
            <CitySearchInput label="到达城市" value={search.toCityCode} cities={cities} onChange={(code) => updateSearch({ toCityCode: code })} error={fieldError(searchErrors, ['到达城市'])} />
            <label className={fieldError(searchErrors, ['日期']) ? 'field has-error' : 'field'}>出发日期<input type="date" value={search.flightDate} onChange={(e) => updateSearch({ flightDate: e.target.value })} aria-invalid={Boolean(fieldError(searchErrors, ['日期']))} /><FieldHint error={fieldError(searchErrors, ['日期'])} /></label>
            <label className="field">成人<input type="number" min="0" value={search.adults} onChange={(e) => updateSearch({ adults: Number(e.target.value) })} /><FieldHint help="成人 18-70 周岁" /></label>
            <label className="field">儿童<input type="number" min="0" value={search.children} onChange={(e) => updateSearch({ children: Number(e.target.value) })} /><FieldHint help="儿童 2-12 周岁" /></label>
            <label className={fieldError(searchErrors, ['婴儿']) ? 'field has-error' : 'field'}>婴儿<input type="number" min="0" value={search.infants} onChange={(e) => updateSearch({ infants: Number(e.target.value) })} aria-invalid={Boolean(fieldError(searchErrors, ['婴儿']))} /><FieldHint error={fieldError(searchErrors, ['婴儿'])} help="婴儿需成人陪同" /></label>
          </div>}
          {!citiesLoading && <div className="route-presets" aria-label="新增航线快速测试">
            <b>新增航线快速测试</b>
            {quickTestRoutes.map((route) => {
              const active = search.fromCityCode === route.fromCityCode && search.toCityCode === route.toCityCode;
              return (
                <button
                  key={`${route.fromCityCode}-${route.toCityCode}`}
                  type="button"
                  className={active ? 'active' : ''}
                  onClick={() => {
                    updateSearch({ fromCityCode: route.fromCityCode, toCityCode: route.toCityCode });
                    setNotice(`已选择 ${route.label}，点击“搜索航班”查看模拟航班。`);
                  }}
                >
                  <span>{route.label}</span>
                  <small>{route.fromCityCode} → {route.toCityCode}</small>
                </button>
              );
            })}
          </div>}
          {searchErrors.length > 0 && <div className="inline-errors">{searchErrors.map((error) => <span key={error}>{error}</span>)}</div>}
          <button className="primary" onClick={submitSearch} disabled={loading || citiesLoading}>{loading ? '查询中...' : '搜索航班'}</button>
        </section>
      )}

      {step === 'flights' && (
        <section className="panel">
          <div className="section-title row-title"><div><h2>航班列表</h2><p>{cityMap.get(search.fromCityCode)?.name} → {cityMap.get(search.toCityCode)?.name} · {search.flightDate}</p></div><select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="timeAsc">出发时间升序</option><option value="timeDesc">出发时间降序</option><option value="priceAsc">价格从低到高</option><option value="priceDesc">价格从高到低</option><option value="duration">航程时长</option></select></div>
          <div className="flight-list">
            {sortedFlights.length === 0 && <p className="empty">暂无符合条件的航班，请调整查询条件。</p>}
            {sortedFlights.map((flight) => <article key={flight.id} className="flight-card">
              <div className="airline"><span>{flight.logoText}</span><div><b>{flight.airline}</b><small>{flight.flightNo} · {flight.aircraft}</small></div></div>
              <div className="times"><div><b>{flight.departureTime}</b><small>{flight.fromAirport}</small></div><i></i><div><b>{flight.arrivalTime}{flight.arrivalNextDay ? '+1天' : ''}</b><small>{flight.toAirport}</small></div></div>
              <div className="flight-meta"><span>{minutesText(flight.durationMinutes)}</span><span>客座率 {flight.loadFactor}%</span><span>总余票 {flight.cabins.reduce((s, c) => s + c.remainingSeats, 0)}</span></div>
              <div className="cabins">{cabinOrder.map((cls) => { const cabin = flight.cabins.find((c) => c.class === cls)!; return <button key={cls} disabled={cabin.remainingSeats <= 0} onClick={() => beginBooking(flight, cls)}><b>{cabin.name}</b><strong>¥{cabin.fare}</strong><small>{cabin.remainingSeats > 0 ? `余${cabin.remainingSeats}张 ${cabin.discountLabel ?? ''}` : '售罄'}</small></button>; })}</div>
            </article>)}
          </div>
        </section>
      )}

      {step === 'booking' && selected && (
        <section className="booking-layout">
          <div className="panel">
            <div className="section-title row-title"><div><h2>乘机人信息</h2><p>{selected.flight.flightNo} · {selected.flight.airline} · {cabinName(selected.cabinClass)} · ¥{selected.fare}</p></div><button className="ghost" onClick={addUmPassenger}>添加UM儿童</button></div>
            {passengers.map((item, index) => {
              const passengerErrors = validatePassenger(item, passengers, search.flightDate);
              return <div className="passenger-card" key={item.id}>
                <h3>{passengerTypeName(item.type)} {index + 1}</h3>
                <div className="form-grid">
                  <label className={fieldError(passengerErrors, ['姓名']) ? 'field has-error' : 'field'}>姓名<input value={item.name} onChange={(e) => updatePassenger(index, { name: e.target.value })} placeholder="中文或英文姓名" aria-invalid={Boolean(fieldError(passengerErrors, ['姓名']))} /><FieldHint error={fieldError(passengerErrors, ['姓名'])} /></label>
                  <label className="field">性别<select value={item.gender} onChange={(e) => updatePassenger(index, { gender: e.target.value as PassengerInput['gender'] })}><option>男</option><option>女</option></select></label>
                  <label className={fieldError(passengerErrors, ['年龄', '出生']) ? 'field has-error' : 'field'}>出生日期<input type="date" value={item.birthDate} onChange={(e) => updatePassenger(index, { birthDate: e.target.value })} aria-invalid={Boolean(fieldError(passengerErrors, ['年龄', '出生']))} /><FieldHint error={fieldError(passengerErrors, ['年龄', '出生'])} /></label>
                  <label className="field">证件类型<select value={item.documentType} onChange={(e) => updatePassenger(index, { documentType: e.target.value as PassengerInput['documentType'] })}>{documentOptionsForType(item.type).map((documentType) => <option key={documentType}>{documentType}</option>)}</select></label>
                  <label className={fieldError(passengerErrors, ['证件号码']) ? 'field has-error' : 'field'}>证件号码<input value={item.documentNumber} onChange={(e) => updatePassenger(index, { documentNumber: e.target.value })} aria-invalid={Boolean(fieldError(passengerErrors, ['证件号码']))} /><FieldHint error={fieldError(passengerErrors, ['证件号码'])} /></label>
                  <label className={fieldError(passengerErrors, ['证件有效期']) ? 'field has-error' : 'field'}>证件有效期<input type="date" value={item.documentExpiry ?? ''} onChange={(e) => updatePassenger(index, { documentExpiry: e.target.value })} aria-invalid={Boolean(fieldError(passengerErrors, ['证件有效期']))} /><FieldHint error={fieldError(passengerErrors, ['证件有效期'])} /></label>
                  <label className={fieldError(passengerErrors, ['联系电话']) ? 'field has-error' : 'field'}>联系电话<input value={item.phone} onChange={(e) => updatePassenger(index, { phone: e.target.value })} aria-invalid={Boolean(fieldError(passengerErrors, ['联系电话']))} /><FieldHint error={fieldError(passengerErrors, ['联系电话'])} /></label>
                  <label className={fieldError(passengerErrors, ['邮箱']) ? 'field has-error' : 'field'}>电子邮箱<input value={item.email ?? ''} onChange={(e) => updatePassenger(index, { email: e.target.value })} placeholder="成人选填" aria-invalid={Boolean(fieldError(passengerErrors, ['邮箱']))} /><FieldHint error={fieldError(passengerErrors, ['邮箱'])} /></label>
                  <label className={fieldError(passengerErrors, ['关联一名成人']) ? 'field has-error' : 'field'}>同行成人<select value={item.linkedAdultId ?? ''} onChange={(e) => updatePassenger(index, { linkedAdultId: e.target.value })} aria-invalid={Boolean(fieldError(passengerErrors, ['关联一名成人']))}><option value="">无</option>{passengers.filter((p) => p.type === 'adult').map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select><FieldHint error={fieldError(passengerErrors, ['关联一名成人'])} /></label>
                </div>
                {item.type === 'um' && <div className="form-grid um-grid"><label className={fieldError(passengerErrors, ['送机人']) ? 'field has-error' : 'field'}>送机人姓名<input value={item.sender?.name ?? ''} onChange={(e) => updatePassenger(index, { sender: { ...(item.sender ?? { phone: '' }), name: e.target.value } })} /></label><label>送机人电话<input value={item.sender?.phone ?? ''} onChange={(e) => updatePassenger(index, { sender: { ...(item.sender ?? { name: '' }), phone: e.target.value } })} /></label><label>送机人证件号<input value={item.sender?.documentNumber ?? ''} onChange={(e) => updatePassenger(index, { sender: { ...(item.sender ?? { name: '', phone: '' }), documentNumber: e.target.value } })} /></label><label className={fieldError(passengerErrors, ['接机人']) ? 'field has-error' : 'field'}>接机人姓名<input value={item.receiver?.name ?? ''} onChange={(e) => updatePassenger(index, { receiver: { ...(item.receiver ?? { phone: '' }), name: e.target.value } })} /></label><label>接机人电话<input value={item.receiver?.phone ?? ''} onChange={(e) => updatePassenger(index, { receiver: { ...(item.receiver ?? { name: '' }), phone: e.target.value } })} /></label><label>关系<input value={item.receiver?.relationship ?? ''} onChange={(e) => updatePassenger(index, { receiver: { ...(item.receiver ?? { name: '', phone: '' }), relationship: e.target.value } })} /></label><label className="wide">特殊说明<input value={item.note ?? ''} onChange={(e) => updatePassenger(index, { note: e.target.value })} placeholder="食物过敏、行为习惯等备注" /></label>{passengerErrors.length > 0 && <div className="inline-errors wide">{passengerErrors.map((error) => <span key={error}>{error}</span>)}</div>}</div>}
              </div>;
            })}
            <div className="passenger-card"><h3>联系人信息</h3><div className="form-grid"><label className={fieldError(contactErrors, ['联系人姓名']) ? 'field has-error' : 'field'}>联系人姓名<input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /><FieldHint error={fieldError(contactErrors, ['联系人姓名'])} /></label><label className={fieldError(contactErrors, ['联系人电话']) ? 'field has-error' : 'field'}>联系人电话<input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /><FieldHint error={fieldError(contactErrors, ['联系人电话'])} /></label><label className={fieldError(contactErrors, ['联系人邮箱']) ? 'field has-error' : 'field'}>邮箱<input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /><FieldHint error={fieldError(contactErrors, ['联系人邮箱'])} /></label></div></div>
          </div>
          <aside className="panel summary-panel"><h2>订单确认</h2><p>{selected.flight.flightNo} · {selected.flight.fromAirport} → {selected.flight.toAirport}</p><ul>{passengers.map((p) => <li key={p.id}>{p.name || '待填写'} · {passengerTypeName(p.type)} · ¥{calculatePassengerFare(selected.fare, p.type)}</li>)}</ul><div className="total">合计 ¥{totalAmount}</div><div className="rules-mini">行李：{baggageRules.find((r) => r.cabin === cabinName(selected.cabinClass))?.checked ?? '按舱位规则'}；退票：起飞前按5%模拟。</div>{requestErrors.length > 0 && <div className="error-list">{requestErrors.slice(0, 6).map((e) => <p key={e}>{e}</p>)}</div>}<button className="primary full" onClick={submitOrder} disabled={loading || requestErrors.length > 0}>{loading ? '提交中...' : '确认预订'}</button></aside>
        </section>
      )}

      {step === 'success' && lastOrder && <OrderTicket order={lastOrder} onOrders={() => { refreshOrders(); setStep('orders'); }} />}

      {step === 'orders' && <section className="panel"><div className="section-title"><h2>订单管理</h2><p>支持查看详情、打印订单/行程单、取消、退票和改签模拟。</p></div><div className="order-list">{orders.map((order) => <article key={order.id} className="order-card"><div><b>{order.orderNo}</b><small>{order.route} · {order.flightDate}</small><p>{order.passengers.map((p) => p.name || passengerTypeName(p.type)).join('、')} · {order.status} · ¥{order.totalAmount}</p>{order.refund && <p>退票手续费 ¥{order.refund.fee}，应退 ¥{order.refund.refundAmount}</p>}{order.change && <p>已改签至 {order.change.targetFlightId}，手续费 ¥{order.change.fee}</p>}</div><div className="order-actions"><button onClick={() => { setLastOrder(order); setStep('success'); }}>详情/电子客票</button><button onClick={() => mutateOrder(order, 'cancel')} disabled={loading}>取消</button><button onClick={() => mutateOrder(order, 'refund')} disabled={loading}>退票</button><button onClick={() => mutateOrder(order, 'change')} disabled={loading}>改签</button></div></article>)}{orders.length === 0 && <p className="empty">暂无订单，请先完成一次预订。</p>}</div></section>}

      {step === 'rules' && <section className="panel"><div className="section-title"><h2>客票运输规则</h2><p>用于学生订票前确认行李、退票、改签和特殊旅客要求。</p></div><div className="rules-grid"><RuleTable title="行李运输规则" rows={rules.baggageRules.map((r) => [r.cabin, r.checked, r.carryOn])} headers={['舱位', '免费托运', '免费随身携带']} /><RuleList title="行李补充说明" items={rules.baggageNotes} /><RuleTable title="退票规则" rows={rules.refundRules.map((r) => [r.cabin, r.before, r.after])} headers={['舱位', '起飞前', '起飞后']} /><RuleList title="退票补充说明" items={rules.refundNotes} /><RuleList title="改签规则" items={rules.changeRules} /><RuleList title="特殊旅客" items={rules.specialPassengerRules} /><div className="rule-reference">参照依据：{rules.ruleReference}</div></div></section>}
    </main>
  );
}

function RuleTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return <div className="rule-box"><h3>{title}</h3><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.join('-')}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
function RuleList({ title, items }: { title: string; items: string[] }) {
  return <div className="rule-box"><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}
function OrderTicket({ order, onOrders }: { order: OrderRecord; onOrders: () => void }) {
  const snapshot = order.flightSnapshot;
  return <section className="ticket-wrap"><div className="panel ticket"><div className="ticket-head"><div><h2>电子客票 / 行程单</h2><p>PNR：{order.pnr} · 订单号：{order.orderNo} · 状态：{order.status}</p></div><button onClick={() => window.print()}>打印/保存PDF</button></div><div className="ticket-route"><b>{order.route}</b><span>{order.flightDate} · {cabinName(order.cabinClass)}</span></div><div className="ticket-details"><div><b>承运航班</b><span>{snapshot?.airline ?? '模拟航司'} {snapshot?.flightNo ?? order.flightId}</span></div><div><b>起降时间</b><span>{snapshot ? `${snapshot.departureTime} → ${snapshot.arrivalTime}${snapshot.arrivalNextDay ? '+1天' : ''}` : '以航班列表为准'}</span></div><div><b>机型/时长</b><span>{snapshot ? `${snapshot.aircraft} · ${minutesText(snapshot.durationMinutes)}` : '模拟机型'}</span></div><div><b>登机口</b><span>留空待填</span></div><div><b>联系人</b><span>{order.contact.name} · {order.contact.phone}</span></div><div><b>出票时间</b><span>{new Date(order.createdAt).toLocaleString('zh-CN')}</span></div></div><div className="ticket-grid">{order.tickets.map((ticket) => { const passenger = order.passengers.find((item) => item.id === ticket.passengerId); return <div key={ticket.ticketNo} className="ticket-item"><b>{ticket.passengerName}</b><span>{passengerTypeName(ticket.passengerType)} · 票号 {ticket.ticketNo}</span><span>证件：{passenger?.documentType ?? '证件'} {passenger?.documentNumber ?? '-'}</span><strong>¥{ticket.fare}</strong></div>; })}</div><div className="qr">二维码区域<br />教学模拟</div><p className="fineprint">本系统所有航班、票号与二维码均为教学模拟数据，不涉及真实交易。打印时可作为课堂行程证明样张使用。</p><button className="primary" onClick={onOrders}>进入订单管理</button></div></section>;
}

export default App;
