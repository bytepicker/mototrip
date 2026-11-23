import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Bike, MapPin, Plus, Share2, Download, Upload, Trash2, Search, LocateFixed, Route, X, ChevronDown, Fuel, TentTree, Camera, ShoppingBag, Coffee, Wrench, Navigation, Menu, Check, Info } from 'lucide-react'
import type { Category, Point, Trip } from './types'

const STORAGE = 'mototrip.trips.v1'
const icons: Record<Category, string> = { start:'🏁', finish:'🏁', waypoint:'📍', sight:'🏞️', fuel:'⛽', camp:'⛺', shop:'🛒', food:'🍜', service:'🔧' }
const categories: {id:Category; label:string; icon:typeof MapPin}[] = [
  {id:'waypoint',label:'Точка маршрута',icon:MapPin},{id:'sight',label:'Достопримечательность',icon:Camera},{id:'fuel',label:'Заправка',icon:Fuel},{id:'camp',label:'Кемпинг',icon:TentTree},{id:'shop',label:'Магазин',icon:ShoppingBag},{id:'food',label:'Еда и кафе',icon:Coffee},{id:'service',label:'Мотосервис',icon:Wrench}
]
const uid = () => Math.random().toString(36).slice(2,10)
const sample: Trip = { id:'sample', name:'Выходные на Ладоге', description:'Тестовый маршрут — можно изменить или удалить. Добавляй точки кликом по карте.', updatedAt:Date.now(), points:[
  {id:'s',name:'Санкт-Петербург',lat:59.9343,lon:30.3351,category:'start',note:'Старт путешествия'},
  {id:'v1',name:'Крепость Корела',lat:61.0394,lon:30.1297,category:'sight',note:'Историческая крепость в Приозерске'},
  {id:'v2',name:'Место для кемпинга',lat:61.185,lon:30.05,category:'camp',note:'Пример точки ночёвки'},
  {id:'f',name:'Сортавала',lat:61.7033,lon:30.6918,category:'finish',note:'Финиш маршрута'}
] }
function loadTrips(): Trip[] { try { const raw=localStorage.getItem(STORAGE); return raw ? JSON.parse(raw) as Trip[] : [sample] } catch { return [sample] } }
function encodeTrip(trip:Trip) { const bytes=new TextEncoder().encode(JSON.stringify(trip)); let binary=''; bytes.forEach(b=>binary+=String.fromCharCode(b)); return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'') }
function decodeTrip(value:string):Trip|null { try { const base=value.replaceAll('-','+').replaceAll('_','/'); const binary=atob(base); const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)); const obj=JSON.parse(new TextDecoder().decode(bytes)) as Trip; if(!obj.name||!Array.isArray(obj.points)) return null; return {...obj,id:uid(),updatedAt:Date.now()} } catch { return null } }
function markerIcon(category:Category) { return L.divIcon({className:'custom-marker-wrap',html:`<div class="map-marker ${category}"><span>${icons[category]}</span></div>`,iconSize:[38,44],iconAnchor:[19,40],popupAnchor:[0,-38]}) }
function MapClick({onAdd}:{onAdd:(lat:number,lon:number)=>void}) { useMapEvents({click:e=>onAdd(e.latlng.lat,e.latlng.lng)}); return null }
function FitBounds({points}:{points:Point[]}) { const map=useMap(); useEffect(()=>{ if(points.length>1) map.fitBounds(points.map(p=>[p.lat,p.lon]),{padding:[48,48]}); else if(points.length===1) map.setView([points[0].lat,points[0].lon],11) },[map,points]); return null }

export default function App() {
  const [trips,setTrips]=useState<Trip[]>(loadTrips)
  const [activeId,setActiveId]=useState(()=>loadTrips()[0]?.id ?? '')
  const [selected,setSelected]=useState<string|null>(null)
  const [addCategory,setAddCategory]=useState<Category>('waypoint')
  const [adding,setAdding]=useState(false)
  const [search,setSearch]=useState('')
  const [searching,setSearching]=useState(false)
  const [notice,setNotice]=useState('')
  const [mobilePanel,setMobilePanel]=useState(false)
  const [routeLine,setRouteLine]=useState<[number,number][]>([])
  const [routeInfo,setRouteInfo]=useState<{distance:number;duration:number}|null>(null)
  const [routeLoading,setRouteLoading]=useState(false)
  const [routeError,setRouteError]=useState('')
  const active=trips.find(t=>t.id===activeId) ?? trips[0]
  const points=active?.points ?? []
  const ordered=points
  const selectedPoint=points.find(p=>p.id===selected)
  const path=useMemo(()=>points.filter(p=>p.category==='start'||p.category==='finish'||p.category==='waypoint'),[points])

  useEffect(()=>{localStorage.setItem(STORAGE,JSON.stringify(trips))},[trips])
  useEffect(()=>{const hash=location.hash.match(/#trip=([^&]+)/); if(hash){const shared=decodeTrip(hash[1]); if(shared){setTrips(prev=>[shared,...prev.filter(t=>t.id!==shared.id)]);setActiveId(shared.id);setNotice('Маршрут из ссылки импортирован. Сохранён в этом браузере.'); history.replaceState(null,'',location.pathname+location.search)}}},[])
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(t)},[notice])

  const updateActive=useCallback((fn:(trip:Trip)=>Trip)=>setTrips(prev=>prev.map(t=>t.id===activeId?fn(t):t)),[activeId])
  const addPoint=(lat:number,lon:number)=>{if(!active)return; const n=points.length; const category:Category= n===0?'start':(addCategory==='start'||addCategory==='finish'?'waypoint':addCategory); const point:Point={id:uid(),name:category==='start'?'Старт':categories.find(c=>c.id===category)?.label??'Точка',lat,lon,category,note:''}; updateActive(t=>({...t,updatedAt:Date.now(),points:[...t.points,point]}));setSelected(point.id);setAdding(false);setNotice('Точка добавлена') }
  const patchPoint=(id:string,patch:Partial<Point>)=>updateActive(t=>({...t,updatedAt:Date.now(),points:t.points.map(p=>p.id===id?{...p,...patch}:p)}))
  const removePoint=(id:string)=>{updateActive(t=>{let next=t.points.filter(p=>p.id!==id); if(next.length){if(!next.some(p=>p.category==='start'))next[0]={...next[0],category:'start'}; if(!next.some(p=>p.category==='finish')&&next.length>1)next[next.length-1]={...next[next.length-1],category:'finish'}} return {...t,points:next,updatedAt:Date.now()}});setSelected(null)}
  const createTrip=()=>{const t:Trip={id:uid(),name:'Новый маршрут',description:'',updatedAt:Date.now(),points:[]};setTrips(p=>[t,...p]);setActiveId(t.id);setSelected(null);clearRoute();setMobilePanel(true)}
  const deleteTrip=()=>{if(!active||!confirm(`Удалить маршрут «${active.name}»?`))return;const next=trips.filter(t=>t.id!==active.id);setTrips(next);setActiveId(next[0]?.id??'');setSelected(null)}
  const share=async()=>{if(!active)return;const url=`${location.origin}${location.pathname}#trip=${encodeTrip(active)}`;try{await navigator.clipboard.writeText(url);setNotice('Ссылка на маршрут скопирована')}catch{prompt('Скопируй ссылку на маршрут:',url)}}
  const exportTrip=()=>{if(!active)return;const blob=new Blob([JSON.stringify(active,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${active.name.replace(/[^\p{L}\p{N}-]+/gu,'_')||'mototrip'}.json`;a.click();URL.revokeObjectURL(url)}
  const importTrip=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const raw=JSON.parse(String(reader.result)) as Trip;if(!raw.name||!Array.isArray(raw.points))throw new Error('Invalid trip');const t:Trip={...raw,id:uid(),updatedAt:Date.now()};setTrips(p=>[t,...p]);setActiveId(t.id);setSelected(null);clearRoute();setNotice('Маршрут импортирован')}catch{setNotice('Не удалось прочитать JSON-маршрут')}};reader.readAsText(file)}
  const findPlace=async()=>{if(!search.trim())return;setSearching(true);try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(search)}`);const data=await r.json() as {lat:string;lon:string;display_name:string}[];if(!data.length){setNotice('Ничего не найдено');return}const p=data[0];addPoint(Number(p.lat),Number(p.lon));setSearch('')}catch{setNotice('Ошибка поиска. Проверь подключение к интернету.')}finally{setSearching(false)}}
  const buildRoute=async()=>{if(path.length<2){setNotice('Добавь минимум две точки маршрута');return}setRouteLoading(true);setRouteError('');try{const coords=path.map(p=>`${p.lon},${p.lat}`).join(';');const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);if(!r.ok)throw new Error('Сервис маршрутизации недоступен');const data=await r.json();if(data.code!=='Ok'||!data.routes?.length)throw new Error('Не удалось построить маршрут по дорогам');setRouteLine(data.routes[0].geometry.coordinates.map((c:number[])=>[c[1],c[0]]));setRouteInfo({distance:data.routes[0].distance,duration:data.routes[0].duration});setNotice('Маршрут по дорогам построен')}catch(e){setRouteError(e instanceof Error?e.message:'Ошибка маршрутизации')}finally{setRouteLoading(false)}}
  const clearRoute=()=>{setRouteLine([]);setRouteInfo(null)}
  const movePoint=(id:string,dir:-1|1)=>updateActive(t=>{const i=t.points.findIndex(p=>p.id===id),j=i+dir;if(i<0||j<0||j>=t.points.length)return t;const arr=[...t.points];[arr[i],arr[j]]=[arr[j],arr[i]];return {...t,points:arr,updatedAt:Date.now()}})

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Bike size={23}/></div><div><div className="brand-name">MOTO<span>TRIP</span></div><div className="brand-sub">ПЛАНИРОВЩИК ПУТЕШЕСТВИЙ</div></div></div><div className="top-actions"><span className="save-state"><span className="save-dot"/>Сохранено локально</span><button className="icon-button mobile-only" onClick={()=>setMobilePanel(!mobilePanel)} aria-label="Открыть панель"><Menu size={20}/></button><button className="button secondary" onClick={share} disabled={!active}><Share2 size={16}/> Поделиться</button><button className="button primary" onClick={createTrip}><Plus size={17}/> Новый маршрут</button></div></header>
    <main className="workspace">
      <aside className={`sidebar ${mobilePanel?'mobile-open':''}`}>
        <div className="sidebar-head"><div><div className="eyebrow">МОИ ПОЕЗДКИ</div><h2>Маршруты</h2></div><button className="icon-button" onClick={createTrip} title="Создать маршрут"><Plus size={18}/></button></div>
        <div className="trip-select-list">{trips.map(t=><button key={t.id} className={`trip-card ${t.id===active?.id?'active':''}`} onClick={()=>{setActiveId(t.id);setSelected(null);clearRoute();setMobilePanel(false)}}><div className="trip-card-icon"><Route size={17}/></div><div className="trip-card-copy"><strong>{t.name||'Без названия'}</strong><span>{t.points.length} точек · {new Date(t.updatedAt).toLocaleDateString('ru-RU')}</span></div><ChevronDown size={15} className="trip-card-arrow"/></button>)}</div>
        {active&&<>
          <div className="section-divider"/>
          <div className="trip-edit-head"><div className="eyebrow">ТЕКУЩИЙ МАРШРУТ</div><button className="icon-button danger-hover" onClick={deleteTrip} title="Удалить маршрут"><Trash2 size={16}/></button></div>
          <input className="trip-title-input" value={active.name} onChange={e=>updateActive(t=>({...t,name:e.target.value,updatedAt:Date.now()}))} placeholder="Название маршрута" />
          <textarea className="trip-description" value={active.description} onChange={e=>updateActive(t=>({...t,description:e.target.value,updatedAt:Date.now()}))} placeholder="Краткое описание поездки…" rows={2}/>
          <div className="route-stats"><div><span>ТОЧЕК</span><strong>{points.length}</strong></div><div><span>МАРШРУТ</span><strong>{routeInfo?`${(routeInfo.distance/1000).toFixed(0)} км`:'—'}</strong></div><div><span>В ПУТИ</span><strong>{routeInfo?`${Math.round(routeInfo.duration/3600)} ч`:'—'}</strong></div></div>
          <div className="points-heading"><div><div className="eyebrow">ПЛАН ПОЕЗДКИ</div><h3>Точки маршрута <span>{points.length}</span></h3></div><button className="text-button" onClick={()=>setAdding(!adding)}><Plus size={15}/> Добавить</button></div>
          {adding&&<div className="add-hint"><div className="add-hint-title">Выбери категорию и нажми на карту</div><div className="category-grid">{categories.map(c=><button key={c.id} className={`category-chip ${addCategory===c.id?'chosen':''}`} onClick={()=>setAddCategory(c.id)}><c.icon size={14}/>{c.label}</button>)}</div><button className="cancel-add" onClick={()=>setAdding(false)}>Отмена</button></div>}
          <div className="point-list">{ordered.length===0&&<div className="empty-points"><MapPin size={24}/><strong>Пока здесь пусто</strong><span>Добавь первую точку кликом по карте или через поиск.</span></div>}{ordered.map((p,i)=><div key={p.id} className={`point-row ${selected===p.id?'selected':''}`}><button className="point-select" onClick={()=>setSelected(selected===p.id?null:p.id)}><span className={`point-icon ${p.category}`}>{icons[p.category]}</span><span className="point-text"><strong>{p.name}</strong><small>{p.note||categories.find(c=>c.id===p.category)?.label|| (p.category==='start'?'Старт':p.category==='finish'?'Финиш':'Точка')}</small></span></button><div className="point-actions"><button onClick={()=>movePoint(p.id,-1)} disabled={i===0} title="Выше">↑</button><button onClick={()=>movePoint(p.id,1)} disabled={i===points.length-1} title="Ниже">↓</button><button onClick={()=>removePoint(p.id)} title="Удалить"><X size={14}/></button></div></div>)}</div>
          {selectedPoint&&<div className="point-editor"><div className="editor-head"><strong>Редактирование точки</strong><button className="icon-button" onClick={()=>setSelected(null)}><X size={16}/></button></div><label>Название<input value={selectedPoint.name} onChange={e=>patchPoint(selectedPoint.id,{name:e.target.value})}/></label><label>Заметка<textarea rows={2} value={selectedPoint.note} onChange={e=>patchPoint(selectedPoint.id,{note:e.target.value})} placeholder="Что важно помнить?"/></label><label>Категория<select value={selectedPoint.category} onChange={e=>patchPoint(selectedPoint.id,{category:e.target.value as Category})}>{[{id:'start',label:'Старт'},{id:'finish',label:'Финиш'},...categories].map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><div className="coords">{selectedPoint.lat.toFixed(5)}, {selectedPoint.lon.toFixed(5)}</div></div>}
          <div className="route-actions"><button className="button primary full" onClick={buildRoute} disabled={routeLoading||path.length<2}><Navigation size={16}/>{routeLoading?'Строим…':'Построить маршрут по дорогам'}</button>{routeError&&<div className="error-text">{routeError}</div>}{routeInfo&&<button className="button secondary full" onClick={clearRoute}>Сбросить линию маршрута</button>}<div className="route-note"><Info size={13}/> Для построения используется автомобильный профиль OSRM. Точки интереса не влияют на прокладку маршрута.</div></div>
          <div className="sidebar-footer"><button className="footer-action" onClick={exportTrip}><Download size={15}/> Экспорт JSON</button><label className="footer-action file-label"><Upload size={15}/> Импорт JSON<input type="file" accept="application/json,.json" onChange={e=>importTrip(e.target.files?.[0])}/></label></div>
        </>}
      </aside>
      <section className="map-area"><div className="map-toolbar"><div className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&findPlace()} placeholder="Найти город или место…"/><button onClick={findPlace} disabled={searching}>{searching?'…':'Найти'}</button></div><div className="map-tip"><LocateFixed size={14}/> {adding?'Кликни по карте, чтобы поставить точку':'Клик по карте — добавить точку'}</div></div>
        <MapContainer center={[60.1,30.4]} zoom={7} zoomControl={false} className="map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitBounds points={points}/><MapClick onAdd={addPoint}/>{routeLine.length>1&&<Polyline positions={routeLine} pathOptions={{color:'#f07836',weight:5,opacity:.9}}/>}{points.map(p=><Marker key={p.id} position={[p.lat,p.lon]} icon={markerIcon(p.category)} eventHandlers={{click:()=>setSelected(p.id)}}><Popup><div className="popup-title">{icons[p.category]} {p.name}</div>{p.note&&<div className="popup-note">{p.note}</div>}<button className="popup-edit" onClick={()=>setSelected(p.id)}>Редактировать точку</button></Popup></Marker>)}</MapContainer>
        <div className="map-legend"><span><i className="legend-dot start"/>Старт / финиш</span><span><i className="legend-dot sight"/>Интересное место</span><span><i className="legend-dot camp"/>Кемпинг</span><span><i className="legend-dot fuel"/>Заправка</span></div>
        <div className="map-bottom"><div className="map-bottom-brand"><Bike size={17}/> Планируй маршрут. Исследуй больше.</div><div className="map-bottom-right">Карта © OpenStreetMap</div></div>
      </section>
    </main>
    {notice&&<div className="toast"><Check size={16}/>{notice}</div>}
    <footer className="app-footer"><span>MOTOTRIP <b>v0.1.0</b></span><span>Данные хранятся в этом браузере · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Сообщить об ошибке карты</a></span></footer>
  </div>
}
