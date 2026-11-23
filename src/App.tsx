import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Bike, MapPin, Plus, Share2, Download, Upload, Trash2, Search, LocateFixed, Route, X, ChevronDown, Fuel, TentTree, Camera, ShoppingBag, Coffee, Wrench, Navigation, Menu, Check, Info, Layers, RefreshCw } from 'lucide-react'
import type { Category, Point, Trip } from './types'

type PoiCategory = Exclude<Category, 'start' | 'finish' | 'waypoint'>
type Poi = { id: string; osmType: string; osmId: number; name: string; lat: number; lon: number; category: PoiCategory; tags: Record<string, string> }
type OverpassElement = { type: string; id: number; lat?: number; lon?: number; center?: {lat:number;lon:number}; tags?: Record<string,string> }

const STORAGE = 'mototrip.trips.v1'
const NEXTGIS_KEY_STORAGE = 'mototrip.nextgis.overpass-key.v1'
const POI_CACHE_STORAGE = 'mototrip.poi-cache.v1'
const POI_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const POI_CACHE_LIMIT = 40
const NEXTGIS_ENDPOINT = (key: string) => `https://overpass.nextgis.com/${encodeURIComponent(key.trim())}/api/interpreter`
const icons: Record<Category, string> = { start:'🏁', finish:'🏁', waypoint:'📍', sight:'🏞️', fuel:'⛽', camp:'⛺', shop:'🛒', food:'🍜', service:'🔧' }
const categories: {id:Category; label:string; icon:typeof MapPin}[] = [
  {id:'waypoint',label:'Точка маршрута',icon:MapPin},{id:'sight',label:'Достопримечательность',icon:Camera},{id:'fuel',label:'Заправка',icon:Fuel},{id:'camp',label:'Кемпинг',icon:TentTree},{id:'shop',label:'Магазин',icon:ShoppingBag},{id:'food',label:'Еда и кафе',icon:Coffee},{id:'service',label:'Мотосервис',icon:Wrench}
]
const poiCategories: {id:PoiCategory; label:string; icon:string}[] = [
  {id:'sight',label:'Достопримечательности',icon:'🏞️'},{id:'fuel',label:'Заправки',icon:'⛽'},{id:'camp',label:'Кемпинги',icon:'⛺'},{id:'shop',label:'Магазины',icon:'🛒'},{id:'food',label:'Кафе и еда',icon:'🍜'},{id:'service',label:'Мотосервисы',icon:'🔧'}
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
function poiMarkerIcon(category:PoiCategory) { return L.divIcon({className:'custom-marker-wrap poi-marker-wrap',html:`<div class="map-marker poi-marker ${category}"><span>${icons[category]}</span></div>`,iconSize:[34,38],iconAnchor:[17,35],popupAnchor:[0,-32]}) }
function MapClick({onAdd}:{onAdd:(lat:number,lon:number)=>void}) { useMapEvents({click:e=>onAdd(e.latlng.lat,e.latlng.lng)}); return null }
function FitBounds({points}:{points:Point[]}) { const map=useMap(); useEffect(()=>{ if(points.length>1) map.fitBounds(points.map(p=>[p.lat,p.lon]),{padding:[48,48]}); else if(points.length===1) map.setView([points[0].lat,points[0].lon],11) },[map,points]); return null }
type PoiCacheEntry = { savedAt:number; pois:Poi[] }
function poiCacheKey(coords:[number,number][]) { return coords.map(([lat,lon])=>`${lat.toFixed(3)},${lon.toFixed(3)}`).join(';') }
function readPoiCache(key:string):Poi[]|null { try { const cache=JSON.parse(localStorage.getItem(POI_CACHE_STORAGE)||'{}') as Record<string,PoiCacheEntry>; const entry=cache[key]; if(!entry||Date.now()-entry.savedAt>POI_CACHE_TTL)return null; return entry.pois } catch { return null } }
function writePoiCache(key:string,pois:Poi[]) { try { const cache=JSON.parse(localStorage.getItem(POI_CACHE_STORAGE)||'{}') as Record<string,PoiCacheEntry>; cache[key]={savedAt:Date.now(),pois}; const sorted=Object.entries(cache).sort((a,b)=>b[1].savedAt-a[1].savedAt).slice(0,POI_CACHE_LIMIT); localStorage.setItem(POI_CACHE_STORAGE,JSON.stringify(Object.fromEntries(sorted))) } catch { /* Cache is optional; quota errors must not break POI search. */ } }
function sampleAlongLine(line:[number,number][], maxSamples=12):[number,number][] {
  if (!line.length) return []
  if (line.length <= maxSamples) return line
  const result:[number,number][]=[]
  for(let i=0;i<maxSamples;i++) result.push(line[Math.round(i*(line.length-1)/(maxSamples-1))])
  return result
}
function classify(tags:Record<string,string>):PoiCategory|null {
  if (tags.amenity === 'fuel') return 'fuel'
  if (tags.tourism && /^(attraction|museum|viewpoint|zoo|theme_park|gallery|artwork|aquarium|monument|castle|heritage)$/.test(tags.tourism)) return 'sight'
  if (tags.historic && /^(castle|monument|memorial|ruins|fort|archaeological_site)$/.test(tags.historic)) return 'sight'
  if (tags.natural === 'peak' || tags.viewpoint === 'yes') return 'sight'
  if (tags.tourism === 'camp_site' || tags.tourism === 'caravan_site' || tags.camp_site === 'yes') return 'camp'
  if (tags.shop && /^(supermarket|convenience|general|motorcycle|outdoor|bakery)$/.test(tags.shop)) return 'shop'
  if (tags.amenity && /^(restaurant|cafe|fast_food|food_court|pub|bar)$/.test(tags.amenity)) return 'food'
  if (tags.amenity === 'car_repair' || tags.shop === 'car_repair' || tags.shop === 'motorcycle_repair' || tags.craft === 'car_repair') return 'service'
  return null
}
function overpassQuery(coords:[number,number][]) {
  // Keep the corridor query compact: 12 sample points, 3.5 km radius, only useful tag groups.
  const around=coords.map(([lat,lon])=>`nwr(around:3500,${lat.toFixed(5)},${lon.toFixed(5)})["tourism"~"attraction|museum|viewpoint|zoo|theme_park|gallery|artwork|aquarium|monument|castle|heritage"];
nwr(around:3500,${lat.toFixed(5)},${lon.toFixed(5)})["historic"~"castle|monument|memorial|ruins|fort|archaeological_site"];
nwr(around:3500,${lat.toFixed(5)},${lon.toFixed(5)})["amenity"~"fuel|restaurant|cafe|fast_food|food_court|pub|bar|car_repair"];
nwr(around:3500,${lat.toFixed(5)},${lon.toFixed(5)})["tourism"~"camp_site|caravan_site"];
nwr(around:3500,${lat.toFixed(5)},${lon.toFixed(5)})["shop"~"supermarket|convenience|general|motorcycle|outdoor|bakery|car_repair|motorcycle_repair"];`).join('\n')
  return `[out:json][timeout:45];(${around});out center tags;`
}
async function requestOverpass(query:string, apiKey:string):Promise<{elements:OverpassElement[]}> {
  if (!apiKey.trim()) throw new Error('Сначала укажи API-ключ NextGIS в настройках поиска объектов.')
  const endpoint=NEXTGIS_ENDPOINT(apiKey)
  let lastError='NextGIS Overpass API недоступен'
  // Retry transient gateway/rate-limit/server errors twice; do not retry invalid credentials or malformed queries.
  for (let attempt=0; attempt<3; attempt++) {
    const controller=new AbortController()
    const timer=window.setTimeout(()=>controller.abort(),60000)
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:query}),signal:controller.signal})
      const body=await response.text()
      if (!response.ok) {
        lastError=response.status===401||response.status===403?'NextGIS отклонил API-ключ. Проверь ключ в настройках.':response.status===429?'NextGIS ограничил частоту запросов (429).':`NextGIS вернул HTTP ${response.status}`
        if ([400,401,403,413].includes(response.status)) throw new Error(lastError)
        if (attempt<2) await new Promise(resolve=>window.setTimeout(resolve,1200*(attempt+1)))
        continue
      }
      let data:{elements?:OverpassElement[];remark?:string}
      try { data=JSON.parse(body) as {elements?:OverpassElement[];remark?:string} }
      catch { throw new Error('NextGIS вернул ответ, который не удалось прочитать.') }
      if (data.remark) throw new Error(`NextGIS не выполнил запрос: ${data.remark}`)
      return {elements:data.elements??[]}
    } catch (error) {
      if (error instanceof Error && !error.message.includes('Failed to fetch') && !(error instanceof DOMException)) throw error
      lastError=error instanceof DOMException && error.name==='AbortError'?'Превышено время ожидания NextGIS (60 секунд)':error instanceof Error?error.message:'Ошибка соединения с NextGIS'
      if (attempt<2) await new Promise(resolve=>window.setTimeout(resolve,1200*(attempt+1)))
    } finally { window.clearTimeout(timer) }
  }
  throw new Error(`${lastError}. Попробуй повторить поиск позже.`)
}
function gpxEscape(value:string) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;') }
function downloadFile(name:string, content:string, type:string) { const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url) }

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
  const [routeBuiltFor,setRouteBuiltFor]=useState('')
  const [pois,setPois]=useState<Poi[]>([])
  const [poiLoading,setPoiLoading]=useState(false)
  const [poiError,setPoiError]=useState('')
  const [poiCacheHit,setPoiCacheHit]=useState(false)
  const [optimizing,setOptimizing]=useState(false)
  const [nextgisKey,setNextgisKey]=useState(()=>localStorage.getItem(NEXTGIS_KEY_STORAGE)??'')
  const [showPoiSettings,setShowPoiSettings]=useState(false)
  const [showPoiFilters,setShowPoiFilters]=useState(true)
  const [poiVisible,setPoiVisible]=useState<Record<PoiCategory,boolean>>({sight:true,fuel:true,camp:true,shop:true,food:true,service:true})
  const poiRequestAt=useRef(0)
  const active=trips.find(t=>t.id===activeId) ?? trips[0]
  const points=active?.points ?? []
  const selectedPoint=points.find(p=>p.id===selected)
  // Every planned stop is a routing waypoint, regardless of its category.
  const path=points
  const routeSignature=useMemo(()=>points.map(p=>`${p.id}:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|'),[points])
  const routeIsStale=Boolean(routeLine.length>1 && routeBuiltFor!==routeSignature)
  const visiblePois=pois.filter(p=>poiVisible[p.category])

  useEffect(()=>{localStorage.setItem(STORAGE,JSON.stringify(trips))},[trips])
  useEffect(()=>{const hash=location.hash.match(/#trip=([^&]+)/); if(hash){const shared=decodeTrip(hash[1]); if(shared){setTrips(prev=>[shared,...prev.filter(t=>t.id!==shared.id)]);setActiveId(shared.id);setNotice('Маршрут из ссылки импортирован. Сохранён в этом браузере.'); history.replaceState(null,'',location.pathname+location.search)}}},[])
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice])

  const updateActive=useCallback((fn:(trip:Trip)=>Trip)=>setTrips(prev=>prev.map(t=>t.id===activeId?fn(t):t)),[activeId])
  const clearRoute=()=>{setRouteLine([]);setRouteInfo(null);setRouteBuiltFor('');setRouteError('')}
  const addPoint=(lat:number,lon:number,categoryOverride?:Category,name?:string,note='')=>{if(!active)return; const requestedCategory=categoryOverride??addCategory; const category:Category=points.length===0?'start':requestedCategory==='start'||requestedCategory==='finish'?'waypoint':requestedCategory; const point:Point={id:uid(),name:name??(category==='start'?'Старт':categories.find(c=>c.id===category)?.label??'Точка'),lat,lon,category,note}; updateActive(t=>{const finishIndex=t.points.findIndex(p=>p.category==='finish');const next=[...t.points];next.splice(finishIndex<0?next.length:finishIndex,0,point);return {...t,updatedAt:Date.now(),points:next}});setSelected(point.id);setAdding(false);setNotice('Точка добавлена в маршрут') }
  const addPoi=(poi:Poi)=>{if(!active)return;if(points.some(p=>p.note.includes(`osm:${poi.osmType}/${poi.osmId}`))){setNotice('Это место уже добавлено');return}addPoint(poi.lat,poi.lon,poi.category,poi.name,`Добавлено из OpenStreetMap · osm:${poi.osmType}/${poi.osmId}`)}
  const patchPoint=(id:string,patch:Partial<Point>)=>updateActive(t=>({...t,updatedAt:Date.now(),points:t.points.map(p=>p.id===id?{...p,...patch}:p)}))
  const removePoint=(id:string)=>{updateActive(t=>{let next=t.points.filter(p=>p.id!==id); if(next.length){if(!next.some(p=>p.category==='start'))next[0]={...next[0],category:'start'}; if(!next.some(p=>p.category==='finish')&&next.length>1)next[next.length-1]={...next[next.length-1],category:'finish'}} return {...t,points:next,updatedAt:Date.now()}});setSelected(null)}
  const createTrip=()=>{const t:Trip={id:uid(),name:'Новый маршрут',description:'',updatedAt:Date.now(),points:[]};setTrips(p=>[t,...p]);setActiveId(t.id);setSelected(null);clearRoute();setPois([]);setMobilePanel(true)}
  const deleteTrip=()=>{if(!active||!confirm(`Удалить маршрут «${active.name}»?`))return;const next=trips.filter(t=>t.id!==active.id);setTrips(next);setActiveId(next[0]?.id??'');setSelected(null);clearRoute();setPois([])}
  const share=async()=>{if(!active)return;const url=`${location.origin}${location.pathname}#trip=${encodeTrip(active)}`;try{await navigator.clipboard.writeText(url);setNotice('Ссылка на маршрут скопирована')}catch{prompt('Скопируй ссылку на маршрут:',url)}}
  const exportTrip=()=>{if(active)downloadFile(`${active.name.replace(/[^\p{L}\p{N}-]+/gu,'_')||'mototrip'}.json`,JSON.stringify(active,null,2),'application/json')}
  const exportGpx=()=>{if(!active)return;const waypoints=points.map(p=>`  <wpt lat="${p.lat}" lon="${p.lon}"><name>${gpxEscape(p.name)}</name><type>${p.category}</type>${p.note?`<desc>${gpxEscape(p.note)}</desc>`:''}</wpt>`).join('\n');const track=routeLine.length>1?`\n  <trk><name>${gpxEscape(active.name)}</name><trkseg>\n${routeLine.map(([lat,lon])=>`    <trkpt lat="${lat}" lon="${lon}"/>`).join('\n')}\n  </trkseg></trk>`:'';const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MotoTrip" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${gpxEscape(active.name)}</name><desc>${gpxEscape(active.description)}</desc></metadata>\n${waypoints}${track}\n</gpx>`;downloadFile(`${active.name.replace(/[^\p{L}\p{N}-]+/gu,'_')||'mototrip'}.gpx`,xml,'application/gpx+xml')}
  const importTrip=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const raw=JSON.parse(String(reader.result)) as Trip;if(!raw.name||!Array.isArray(raw.points))throw new Error('Invalid trip');const t:Trip={...raw,id:uid(),updatedAt:Date.now()};setTrips(p=>[t,...p]);setActiveId(t.id);setSelected(null);clearRoute();setNotice('Маршрут импортирован')}catch{setNotice('Не удалось прочитать JSON-маршрут')}};reader.readAsText(file)}
  const importGpx=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const doc=new DOMParser().parseFromString(String(reader.result),'application/xml');if(doc.querySelector('parsererror'))throw new Error('Invalid GPX');const waypoints=Array.from(doc.getElementsByTagNameNS('*','wpt'));const routePoints=Array.from(doc.getElementsByTagNameNS('*','rtept'));const trackPoints=Array.from(doc.getElementsByTagNameNS('*','trkpt'));const source=waypoints.length?waypoints:routePoints.length?routePoints:trackPoints.length?[trackPoints[0],trackPoints[trackPoints.length-1]]:[];if(!source.length)throw new Error('No points');const imported:Point[]=source.map((el,i)=>{const lat=Number(el.getAttribute('lat')),lon=Number(el.getAttribute('lon'));if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('Invalid coordinates');const name=el.getElementsByTagNameNS('*','name')[0]?.textContent?.trim()||`Точка ${i+1}`;const desc=el.getElementsByTagNameNS('*','desc')[0]?.textContent?.trim()||'';return {id:uid(),name,lat,lon,category:i===0?'start':i===source.length-1&&source.length>1?'finish':'waypoint',note:desc}});const importedTrack:[number,number][]=trackPoints.map(el=>[Number(el.getAttribute('lat')),Number(el.getAttribute('lon'))] as [number,number]).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1]));const title=doc.getElementsByTagNameNS('*','name')[0]?.textContent?.trim()||file.name.replace(/\.gpx$/i,'');const t:Trip={id:uid(),name:title||'Импортированный GPX',description:'Импортировано из GPX',updatedAt:Date.now(),points:imported};setTrips(p=>[t,...p]);setActiveId(t.id);setSelected(null);clearRoute();if(importedTrack.length>1){setRouteLine(importedTrack);setRouteBuiltFor(imported.map(p=>`${p.id}:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|'))}setPois([]);setNotice(`Импортировано точек: ${imported.length}${importedTrack.length>1?' и трек GPX':''}`)}catch{setNotice('Не удалось прочитать GPX-файл')}};reader.readAsText(file)}
  const findPlace=async()=>{if(!search.trim())return;setSearching(true);try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(search)}`);if(!r.ok)throw new Error('Nominatim unavailable');const data=await r.json() as {lat:string;lon:string;display_name:string}[];if(!data.length){setNotice('Ничего не найдено');return}const p=data[0];addPoint(Number(p.lat),Number(p.lon),undefined,p.display_name.split(',')[0]);setSearch('')}catch{setNotice('Ошибка поиска. Проверь подключение к интернету.')}finally{setSearching(false)}}
  const findPois=async(coordsOverride?:[number,number][],forceRefresh=false)=>{const coords=coordsOverride?.length?coordsOverride:sampleAlongLine(routeLine);if(!coords.length){setPoiError('Сначала построй маршрут минимум через две точки.');return}const cacheKey=poiCacheKey(coords);if(!forceRefresh){const cached=readPoiCache(cacheKey);if(cached){setPois(cached);setPoiCacheHit(true);setPoiError('');setNotice(`Загружено из кэша: ${cached.length} объектов`);return}}if(Date.now()-poiRequestAt.current<8000){setPoiError('Подожди несколько секунд перед следующим запросом.');return}poiRequestAt.current=Date.now();setPoiLoading(true);setPoiCacheHit(false);setPoiError('');try{const data=await requestOverpass(overpassQuery(coords),nextgisKey);const found=new Map<string,Poi>();for(const el of data.elements??[]){const tags=el.tags??{};const category=classify(tags);const lat=el.lat??el.center?.lat,lon=el.lon??el.center?.lon;if(!category||lat===undefined||lon===undefined)continue;const name=tags.name||tags['name:ru']||tags.brand||tags.operator||({fuel:'Заправка',camp:'Кемпинг',sight:'Достопримечательность',shop:'Магазин',food:'Кафе / еда',service:'Мотосервис'}[category]);const key=`${el.type}/${el.id}`;found.set(key,{id:key,osmType:el.type,osmId:el.id,name,lat,lon,category,tags})}const result=Array.from(found.values());setPois(result);writePoiCache(cacheKey,result);setNotice(`Найдено объектов: ${found.size}`);if(found.size===0)setPoiError('Запрос выполнен, но в выбранном коридоре Overpass не вернул объектов. Попробуй увеличить радиус поиска или проверить другой участок маршрута.')}catch(e){setPoiError(e instanceof Error?e.message:'Не удалось загрузить объекты')}finally{setPoiLoading(false)}}
  const buildRouteForPoints=async(routePoints:Point[],signature:string)=>{if(routePoints.length<2){setNotice('Добавь минимум две точки маршрута');return}setRouteLoading(true);setRouteError('');try{const coords=routePoints.map(p=>`${p.lon},${p.lat}`).join(';');const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);if(!r.ok)throw new Error('Сервис маршрутизации недоступен');const data=await r.json() as {code:string;routes?:{distance:number;duration:number;geometry:{coordinates:number[][]}}[]};if(data.code!=='Ok'||!data.routes?.length)throw new Error('Не удалось построить маршрут по дорогам');const line=data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]] as [number,number]);setRouteLine(line);setRouteInfo({distance:data.routes[0].distance,duration:data.routes[0].duration});setRouteBuiltFor(signature);setNotice(`Маршрут построен через ${routePoints.length} точек`);void findPois(sampleAlongLine(line))}catch(e){setRouteError(e instanceof Error?e.message:'Ошибка маршрутизации')}finally{setRouteLoading(false)}}
  const buildRoute=()=>buildRouteForPoints(path,routeSignature)
  const optimizeRoute=async()=>{if(points.length<3){setNotice('Для оптимизации нужны старт, финиш и хотя бы одна остановка');return}const startIndex=points.findIndex(p=>p.category==='start');const finishIndex=points.findIndex(p=>p.category==='finish');const start=startIndex>=0?points[startIndex]:(points.find(p=>p.id!==(finishIndex>=0?points[finishIndex].id:''))??points[0]);const finish=finishIndex>=0&&points[finishIndex].id!==start.id?points[finishIndex]:([...points].reverse().find(p=>p.id!==start.id)??points[points.length-1]);const middle=points.filter(p=>p.id!==start.id&&p.id!==finish.id);if(!middle.length){setNotice('Нет промежуточных остановок для сортировки');return}setOptimizing(true);setRouteError('');try{const all=[start,...middle,finish];const coords=all.map(p=>`${p.lon},${p.lat}`).join(';');const response=await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`);if(!response.ok)throw new Error('Сервис расчёта расстояний OSRM недоступен');const matrixData=await response.json() as {code:string;distances?:(number|null)[][]};const matrix=matrixData.distances;if(matrixData.code!=='Ok'||!matrix||matrix.length!==all.length)throw new Error('OSRM не вернул матрицу дорожных расстояний');const n=middle.length;let remaining=middle.map((_,i)=>i+1);const order=[0];let current=0;while(remaining.length){let best=remaining[0],bestDistance=Infinity;for(const candidate of remaining){const d=matrix[current]?.[candidate];if(d!==null&&d!==undefined&&d<bestDistance){best=candidate;bestDistance=d}}if(bestDistance===Infinity)throw new Error('Не удалось связать все остановки дорожной сетью');order.push(best);remaining=remaining.filter(i=>i!==best);current=best}order.push(all.length-1);const routeCost=(sequence:number[])=>sequence.slice(0,-1).reduce((sum,from,i)=>sum+(matrix[from]?.[sequence[i+1]]??Infinity),0);if(!Number.isFinite(routeCost(order)))throw new Error('Между некоторыми остановками нет доступного автомобильного маршрута');let improved=true;while(improved){improved=false;for(let i=1;i<order.length-2;i++){for(let j=i+1;j<order.length-1;j++){const candidate=[...order.slice(0,i),...order.slice(i,j+1).reverse(),...order.slice(j+1)];if(routeCost(candidate)+0.5<routeCost(order)){order.splice(0,order.length,...candidate);improved=true}}}}const optimized=order.map(i=>all[i]);const signature=optimized.map(p=>`${p.id}:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');updateActive(t=>({...t,points:optimized,updatedAt:Date.now()}));setSelected(null);setNotice(`Порядок ${n} остановок оптимизирован`);await buildRouteForPoints(optimized,signature)}catch(e){setRouteError(e instanceof Error?e.message:'Не удалось оптимизировать маршрут')}finally{setOptimizing(false)}}
  const movePoint=(id:string,dir:-1|1)=>updateActive(t=>{const i=t.points.findIndex(p=>p.id===id),j=i+dir;if(i<0||j<0||j>=t.points.length)return t;const arr=[...t.points];[arr[i],arr[j]]=[arr[j],arr[i]];return {...t,points:arr,updatedAt:Date.now()}})

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Bike size={23}/></div><div><div className="brand-name">MOTO<span>TRIP</span></div><div className="brand-sub">ПЛАНИРОВЩИК ПУТЕШЕСТВИЙ</div></div></div><div className="top-actions"><span className="save-state"><span className="save-dot"/>Сохранено локально</span><button className="icon-button mobile-only" onClick={()=>setMobilePanel(!mobilePanel)} aria-label="Открыть панель"><Menu size={20}/></button><button className="button secondary" onClick={share} disabled={!active}><Share2 size={16}/> Поделиться</button><button className="button primary" onClick={createTrip}><Plus size={17}/> Новый маршрут</button></div></header>
    <main className="workspace">
      <aside className={`sidebar ${mobilePanel?'mobile-open':''}`}>
        <div className="sidebar-head"><div><div className="eyebrow">МОИ ПОЕЗДКИ</div><h2>Маршруты</h2></div><button className="icon-button" onClick={createTrip} title="Создать маршрут"><Plus size={18}/></button></div>
        <div className="trip-select-list">{trips.map(t=><button key={t.id} className={`trip-card ${t.id===active?.id?'active':''}`} onClick={()=>{setActiveId(t.id);setSelected(null);clearRoute();setPois([]);setMobilePanel(false)}}><div className="trip-card-icon"><Route size={17}/></div><div className="trip-card-copy"><strong>{t.name||'Без названия'}</strong><span>{t.points.length} точек · {new Date(t.updatedAt).toLocaleDateString('ru-RU')}</span></div><ChevronDown size={15} className="trip-card-arrow"/></button>)}</div>
        {active&&<>
          <div className="section-divider"/><div className="trip-edit-head"><div className="eyebrow">ТЕКУЩИЙ МАРШРУТ</div><button className="icon-button danger-hover" onClick={deleteTrip} title="Удалить маршрут"><Trash2 size={16}/></button></div>
          <input className="trip-title-input" value={active.name} onChange={e=>updateActive(t=>({...t,name:e.target.value,updatedAt:Date.now()}))} placeholder="Название маршрута"/><textarea className="trip-description" value={active.description} onChange={e=>updateActive(t=>({...t,description:e.target.value,updatedAt:Date.now()}))} placeholder="Краткое описание поездки…" rows={2}/>
          <div className="route-stats"><div><span>ТОЧЕК</span><strong>{points.length}</strong></div><div><span>МАРШРУТ</span><strong>{routeInfo?`${(routeInfo.distance/1000).toFixed(0)} км`:'—'}</strong></div><div><span>В ПУТИ</span><strong>{routeInfo?`${Math.round(routeInfo.duration/3600)} ч`:'—'}</strong></div></div>
          <div className="points-heading"><div><div className="eyebrow">ПЛАН ПОЕЗДКИ</div><h3>Точки маршрута <span>{points.length}</span></h3></div><button className="text-button" onClick={()=>setAdding(!adding)}><Plus size={15}/> Добавить</button></div>
          {adding&&<div className="add-hint"><div className="add-hint-title">Выбери категорию и нажми на карту</div><div className="category-grid">{categories.map(c=><button key={c.id} className={`category-chip ${addCategory===c.id?'chosen':''}`} onClick={()=>setAddCategory(c.id)}><c.icon size={14}/>{c.label}</button>)}</div><button className="cancel-add" onClick={()=>setAdding(false)}>Отмена</button></div>}
          <div className="point-list">{points.length===0&&<div className="empty-points"><MapPin size={24}/><strong>Пока здесь пусто</strong><span>Добавь первую точку кликом по карте или через поиск.</span></div>}{points.map((p,i)=><div key={p.id} className={`point-row ${selected===p.id?'selected':''}`}><button className="point-select" onClick={()=>setSelected(selected===p.id?null:p.id)}><span className={`point-icon ${p.category}`}>{icons[p.category]}</span><span className="point-text"><strong>{p.name}</strong><small>{p.note||categories.find(c=>c.id===p.category)?.label|| (p.category==='start'?'Старт':p.category==='finish'?'Финиш':'Точка')}</small></span></button><div className="point-actions"><button onClick={()=>movePoint(p.id,-1)} disabled={i===0} title="Выше">↑</button><button onClick={()=>movePoint(p.id,1)} disabled={i===points.length-1} title="Ниже">↓</button><button onClick={()=>removePoint(p.id)} title="Удалить"><X size={14}/></button></div></div>)}</div>
          {selectedPoint&&<div className="point-editor"><div className="editor-head"><strong>Редактирование точки</strong><button className="icon-button" onClick={()=>setSelected(null)}><X size={16}/></button></div><label>Название<input value={selectedPoint.name} onChange={e=>patchPoint(selectedPoint.id,{name:e.target.value})}/></label><label>Заметка<textarea rows={2} value={selectedPoint.note} onChange={e=>patchPoint(selectedPoint.id,{note:e.target.value})} placeholder="Что важно помнить?"/></label><label>Категория<select value={selectedPoint.category} onChange={e=>patchPoint(selectedPoint.id,{category:e.target.value as Category})}>{[{id:'start',label:'Старт'},{id:'finish',label:'Финиш'},...categories].map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><div className="coords">{selectedPoint.lat.toFixed(5)}, {selectedPoint.lon.toFixed(5)}</div></div>}
          <div className="route-actions"><button className="button secondary full" onClick={optimizeRoute} disabled={optimizing||routeLoading||points.length<3}><Route size={15}/>{optimizing?'Подбираем порядок…':'Автоматически упорядочить остановки'}</button><div className="route-note">Старт и финиш фиксированы. Добавляй остановки в любом порядке — приложение подберёт более короткую последовательность по дорожным расстояниям.</div><button className="button primary full" onClick={buildRoute} disabled={routeLoading||path.length<2}><Navigation size={16}/>{routeLoading?'Строим…':'Построить маршрут через все точки'}</button>{routeIsStale&&<div className="route-stale">Список точек изменён — перестрой маршрут, чтобы линия учитывала изменения.</div>}{routeError&&<div className="error-text">{routeError}</div>}{routeInfo&&<button className="button secondary full" onClick={clearRoute}>Сбросить линию маршрута</button>}<div className="route-note"><Info size={13}/> Линия проходит через все точки списка в указанном порядке. Используется автомобильный профиль OSRM.</div></div>
          <div className="poi-panel"><button className="poi-panel-head" onClick={()=>setShowPoiFilters(!showPoiFilters)}><span><Layers size={15}/> Объекты на карте</span><ChevronDown size={15} className={showPoiFilters?'':'collapsed'}/></button>{showPoiFilters&&<><div className="poi-source-settings"><button className="text-button" onClick={()=>setShowPoiSettings(v=>!v)}><span>Источник: NextGIS Overpass</span><ChevronDown size={14} className={showPoiSettings?'':'collapsed'}/></button>{showPoiSettings&&<div className="poi-key-settings"><label>Персональный API-ключ NextGIS<input type="password" value={nextgisKey} onChange={e=>setNextgisKey(e.target.value)} placeholder="Вставь ключ из личного кабинета NextGIS" autoComplete="off"/></label><button className="button secondary full" onClick={()=>{localStorage.setItem(NEXTGIS_KEY_STORAGE,nextgisKey.trim());setShowPoiSettings(false);setPoiError('');setNotice('Ключ NextGIS сохранён в этом браузере')}} disabled={!nextgisKey.trim()}>Сохранить ключ</button><div className="route-note">Ключ хранится только в LocalStorage этого браузера и отправляется NextGIS при поиске. Не публикуй его в репозитории.</div><a href="https://my.nextgis.com/" target="_blank" rel="noreferrer">Открыть личный кабинет NextGIS для создания ключа</a></div>}</div><div className="poi-filter-grid">{poiCategories.map(c=><label key={c.id} className="poi-filter"><input type="checkbox" checked={poiVisible[c.id]} onChange={e=>setPoiVisible(v=>({...v,[c.id]:e.target.checked}))}/><span>{c.icon}</span>{c.label}</label>)}</div><button className="button secondary full poi-search-button" onClick={()=>void findPois(undefined,true)} disabled={poiLoading||routeLine.length<2}>{poiLoading?<RefreshCw size={14} className="spin"/>:<Search size={14}/>} {poiLoading?'Ищем объекты…':'Обновить объекты вдоль маршрута'}</button><div className="poi-count">На карте: {visiblePois.length} объектов {pois.length!==visiblePois.length?`из ${pois.length}`:''} · {poiCacheHit?'из кэша':'кэш до 7 дней'}</div>{poiError&&<div className="error-text">{poiError}</div>}</>}</div>
          <div className="sidebar-footer"><button className="footer-action" onClick={exportTrip}><Download size={15}/> Экспорт JSON</button><label className="footer-action file-label"><Upload size={15}/> Импорт JSON<input type="file" accept="application/json,.json" onChange={e=>{importTrip(e.target.files?.[0]);e.currentTarget.value=''}}/></label><button className="footer-action" onClick={exportGpx}><Download size={15}/> GPX</button><label className="footer-action file-label"><Upload size={15}/> Импорт GPX<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={e=>{importGpx(e.target.files?.[0]);e.currentTarget.value=''}}/></label></div>
        </>}
      </aside>
      <section className="map-area"><div className="map-toolbar"><div className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&findPlace()} placeholder="Найти город или место…"/><button onClick={findPlace} disabled={searching}>{searching?'…':'Найти'}</button></div><div className="map-tip"><LocateFixed size={14}/> {adding?'Кликни по карте, чтобы поставить точку':'Клик по карте — добавить точку'}</div></div>
        <MapContainer center={[60.1,30.4]} zoom={7} zoomControl={false} className="map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitBounds points={points}/><MapClick onAdd={addPoint}/>{routeLine.length>1&&<Polyline positions={routeLine} pathOptions={{color:'#f07836',weight:5,opacity:routeIsStale?.45:.9,dashArray:routeIsStale?'8 8':undefined}}/>}{visiblePois.map(p=><Marker key={p.id} position={[p.lat,p.lon]} icon={poiMarkerIcon(p.category)}><Popup><div className="popup-title">{icons[p.category]} {p.name}</div><div className="popup-note">{poiCategories.find(c=>c.id===p.category)?.label}</div>{p.tags['addr:street']&&<div className="popup-note">{p.tags['addr:street']} {p.tags['addr:housenumber']??''}</div>}<button className="popup-edit" onClick={()=>addPoi(p)}>Добавить в маршрут</button></Popup></Marker>)}{points.map(p=><Marker key={p.id} position={[p.lat,p.lon]} icon={markerIcon(p.category)} eventHandlers={{click:()=>setSelected(p.id)}}><Popup><div className="popup-title">{icons[p.category]} {p.name}</div>{p.note&&<div className="popup-note">{p.note}</div>}<button className="popup-edit" onClick={()=>setSelected(p.id)}>Редактировать точку</button></Popup></Marker>)}</MapContainer>
        <div className="map-legend"><span><i className="legend-dot start"/>Маршрут</span><span><i className="legend-dot sight"/>Достопримечательности</span><span><i className="legend-dot camp"/>Кемпинги</span><span><i className="legend-dot fuel"/>Заправки</span><span><i className="legend-dot shop"/>Магазины / еда</span></div>
        <div className="map-bottom"><div className="map-bottom-brand"><Bike size={17}/> Планируй маршрут. Исследуй больше.</div><div className="map-bottom-right">Карта и объекты © OpenStreetMap</div></div>
      </section>
    </main>
    {notice&&<div className="toast"><Check size={16}/>{notice}</div>}
    <footer className="app-footer"><span>MOTOTRIP <b>v0.4.0</b></span><span>Данные хранятся в этом браузере · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Сообщить об ошибке карты</a></span></footer>
  </div>
}
