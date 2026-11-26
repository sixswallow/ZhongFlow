const api = require('../../utils/api');
const util = require('../../utils/util');
const { buildMarkerVisual } = require('../../utils/mapMarker');
const { TOWNSHIP_BOUNDARIES } = require('../../utils/townshipBoundaries');
const { getTownshipOptions, getTownshipIndex, resolveTownshipLocation } = require('../../utils/locationOptions');
const geoLayer = require('../../utils/geoLayer');
const geoDatum = require('../../utils/geoDatum');

const DEFAULT_TOWNSHIP_POLYGON_STYLE = {
  strokeWidth: 2,
  strokeColor: '#3f76a8',
  fillColor: '#3f76a81A'
};
const SELECTED_TOWNSHIP_POLYGON_STYLE = {
  strokeWidth: 3,
  strokeColor: '#1677c8',
  fillColor: '#1677c833'
};

const MAX_MAP_MARKERS = 200;

// 常规与选中态的 marker 图标尺寸（选中放大，密集点位里一眼认出当前选中站）
const MARKER_SIZE = { width: 42, height: 49 };
const SELECTED_MARKER_SIZE = { width: 56, height: 65 };

const hasValidCoordinates = (station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude)
  && station.latitude >= -90 && station.latitude <= 90
  && station.longitude >= -180 && station.longitude <= 180;

// ★ 乡镇聚焦用的「点在多边形内」判定（射线法）。
//   站点坐标与乡镇边界同为 WGS-84，直接在同一坐标系里比较，不做基准换算。
const pointInRing = (point, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude;
    const yi = ring[i].latitude;
    const xj = ring[j].longitude;
    const yj = ring[j].latitude;
    const crosses = (yi > point.latitude) !== (yj > point.latitude)
      && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

const boundaryOfTownship = (name) => {
  const boundary = TOWNSHIP_BOUNDARIES.find((item) => item.name === name);
  return boundary ? boundary.points : null;
};

// ★ 微信 <map> 的底图是 GCJ-02，而乡镇分界线与站点数据都是 WGS-84
//   （实测 2026-09-29：8 座水库按 WGS-84→GCJ-02 换算后全部落在坝体/水面上，直接用原始坐标则整体偏约 594m）。
//   凡是交给 <map> / marker / polygon 的坐标，都必须在页面这一层换算 ——
//   天气页那张自绘 canvas 用的是同一套 WGS-84 烘焙底图，那边**不能**换算。
//   分界线点很多，按乡镇名缓存换算结果，避免每次切换都重算。
const polygonCache = {};

const buildTownshipPolygons = (selectedRegionName) => TOWNSHIP_BOUNDARIES.map((boundary) => {
  if (!polygonCache[boundary.name]) polygonCache[boundary.name] = geoDatum.toMapPoints(boundary.points);
  return {
    points: polygonCache[boundary.name],
    ...(boundary.name === selectedRegionName ? SELECTED_TOWNSHIP_POLYGON_STYLE : DEFAULT_TOWNSHIP_POLYGON_STYLE)
  };
});

// 地图中心同样要换算（app.globalData.location 与乡镇中心都出自同一份 WGS-84 数据）
const centerOf = (location) => {
  const p = geoDatum.toMapPoint(location);
  return { centerLat: p.latitude, centerLng: p.longitude };
};

const app = getApp();

Page({
  data: {
    ...centerOf(geoLayer.COUNTY_CENTER),
    scale: 11,
    markers: [],
    markerMap: {},
    activeFilter: 'all',
    totalCount: 0,
    reservoirCount: 0,
    riverCount: 0,
    soilCount: 0,
    visibleMarkerCount: 0,
    hiddenMarkerCount: 0,
    selectedStation: null,
    selectedMarkerId: null,
    allStations: [],
    loadFailed: false,
    selectedRegionName: '中方县',
    townshipOptions: getTownshipOptions(),
    townshipIndex: 0,
    townshipPolygons: buildTownshipPolygons('中方县'),
    // 乡镇聚焦：选中具体乡镇后默认只显示该乡镇内的点位（周边乡镇的密集点位不再遮挡视线），
    // townshipStationCount 供聚焦提示条展示本乡镇点位数
    townshipFocus: true,
    townshipStationCount: 0
  },

  mapContext: null,

  onLoad() {
    const location = app.globalData.location;
    this.mapContext = wx.createMapContext('map', this);
    this.setData({
      ...centerOf(location),
      selectedRegionName: location.city,
      townshipIndex: getTownshipIndex(location),
      townshipPolygons: buildTownshipPolygons(location.city)
    });
    this.loadAllStations();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    const location = app.globalData.location;
    if (location.city !== this.data.selectedRegionName) {
      // 全局定位变了（首页/天气页切换了乡镇）：地图取景跟随，聚焦范围同步切换
      this.setData({
        ...centerOf(location),
        scale: location.city === '中方县' ? 11 : 13,
        selectedRegionName: location.city,
        townshipIndex: getTownshipIndex(location),
        townshipPolygons: buildTownshipPolygons(location.city),
        selectedStation: null,
        selectedMarkerId: null
      });
      if (this.data.allStations.length > 0) {
        this.updateMarkers();
      }
      if (location.city !== '中方县') {
        this.fitTownshipView(location.city);
      }
      return;
    }
    if (this.data.allStations.length > 0) {
      this.updateMarkers();
    }
  },

  async loadAllStations(options = {}) {
    try {
      util.showLoading('加载中...');
      // getStationGroups 保留失败信号：失败时界面给出明确提示，而不是一张安静的空地图
      const groups = await api.getStationGroups(options);
      const stations = groups.list;

      const reservoirCount = stations.filter(s => s.type === 'reservoir').length;
      const riverCount = stations.filter(s => s.type === 'river').length;
      const soilCount = stations.filter(s => s.type === 'soil').length;

      this.setData({
        allStations: stations,
        totalCount: stations.length,
        reservoirCount,
        riverCount,
        soilCount,
        loadFailed: groups.failed && stations.length === 0
      });

      this.updateMarkers();
      util.hideLoading();
    } catch (e) {
      util.hideLoading();
      this.setData({ loadFailed: true });
      console.error('加载站点数据失败', e);
    }
  },

  retryLoad() {
    this.setData({ loadFailed: false });
    this.loadAllStations({ forceRefresh: true });
  },

  updateMarkers() {
    const { allStations, activeFilter, selectedRegionName, townshipFocus, selectedMarkerId } = this.data;
    let filteredStations = allStations;

    if (activeFilter !== 'all') {
      filteredStations = allStations.filter(s => s.type === activeFilter);
    }

    // ★ 乡镇聚焦：选中具体乡镇时默认只渲染该乡镇边界内的点位。
    //   背景：县内点位集中在河谷/集镇，选乡镇后周边乡镇的密集点位会压在视野里，
    //   目标点被遮挡、也容易误点。聚焦后视野干净，悬浮按钮可随时切回全县。
    const ring = selectedRegionName !== '中方县' ? boundaryOfTownship(selectedRegionName) : null;
    let scopedStations = null;
    if (ring) {
      scopedStations = filteredStations.filter(s => hasValidCoordinates(s) && pointInRing(s, ring));
    }
    const scopeStations = ring && townshipFocus ? scopedStations : filteredStations;

    const markerMap = {};
    const mappableStations = scopeStations.filter(hasValidCoordinates);
    const markerStations = mappableStations.slice(0, MAX_MAP_MARKERS);
    const markers = markerStations.map((station, index) => {
      // 地图 marker id 必须是数字
      const markerId = index + 1;
      const selected = station.id === selectedMarkerId;
      const visual = buildMarkerVisual(station, { selected });
      const size = selected ? SELECTED_MARKER_SIZE : MARKER_SIZE;
      markerMap[markerId] = station;

      // ★ 站点坐标是 WGS-84：不换算会整体偏约 594m（东南向），与底图上的村道对不上
      const point = geoDatum.toMapPoint(station);
      return {
        id: markerId,
        latitude: point.latitude,
        longitude: point.longitude,
        iconPath: visual.iconPath,
        width: size.width,
        height: size.height,
        anchor: { x: 0.5, y: 1 },
        title: station.name,
        callout: visual.callout
      };
    });

    this.setData({
      markers,
      markerMap,
      visibleMarkerCount: markers.length,
      hiddenMarkerCount: Math.max(0, mappableStations.length - markers.length),
      townshipStationCount: ring ? scopedStations.length : 0
    });
  },

  // 聚焦取景：用乡镇边界全部点位做 includePoints，让视野完整装下该乡镇全域及轮廓。
  // 边界点是 WGS-84，交给 <map> 前必须换算（同 marker/分界线的口径）。
  // includePoints 不可用的环境（含测试桩）退回 scale 13 的固定取景。
  fitTownshipView(townshipName) {
    if (typeof this.mapContext.includePoints !== 'function') return;
    const boundary = TOWNSHIP_BOUNDARIES.find((item) => item.name === townshipName);
    if (!boundary) return;
    this.mapContext.includePoints({
      points: geoDatum.toMapPoints(boundary.points),
      // padding 单位 px：上 130 清开头部条 + 筛选栏，下 80 清开底部说明条，左右 70 留呼吸
      padding: [130, 70, 80, 70]
    });
  },

  // 聚焦提示已并入顶部控制条：在「只看本乡镇」与「显示全县」之间切换
  toggleScope() {
    this.setData({
      townshipFocus: !this.data.townshipFocus,
      selectedStation: null,
      selectedMarkerId: null
    });
    this.updateMarkers();
  },

  setFilter(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ activeFilter: type, selectedStation: null, selectedMarkerId: null });
    this.updateMarkers();
  },

  onMarkerTap(e) {
    this.selectStation(e.markerId, { animate: true });
  },

  onCalloutTap(e) {
    this.selectStation(e.markerId);
  },

  selectStation(markerId, options = {}) {
    const station = this.data.markerMap[markerId];
    if (!station) return;
    this.setData({ selectedStation: station, selectedMarkerId: station.id });
    // 重建 markers：选中图标放大 + 气泡常驻，密集点位里能一眼认出当前选中站
    this.updateMarkers();

    if (options.animate) {
      this.mapContext.translateMarker({
        markerId: markerId,
        // 与 marker 的实际显示位置保持同一套换算，否则点击动画会把图标挪走 594m
        destination: geoDatum.toMapPoint(station),
        duration: 300
      });
    }

    // 底部站点面板会盖住地图下方约 40%：把选中点抬到面板上方的可视区域，
    // 否则点选画面下半部的站点时，面板正好把刚选中的图标遮住。
    if (typeof this.mapContext.includePoints === 'function') {
      const p = geoDatum.toMapPoint(station);
      // 以选中点为中心构造约 8km 的虚拟包围盒：单点 + padding 会把地图顶到最小视野
      // （用户反馈「选中后视野过小」），给一圈范围才看得清选中站周边的参照物。
      const HALF_SPAN = 0.04; // 度 ≈ 4km（纬向），经向约 3.9km
      this.mapContext.includePoints({
        points: [
          { latitude: p.latitude - HALF_SPAN, longitude: p.longitude - HALF_SPAN },
          { latitude: p.latitude + HALF_SPAN, longitude: p.longitude + HALF_SPAN }
        ],
        // 上小下大的 padding ⇒ 点位落在可视区上半段；padding 单位为 px
        padding: [200, 90, 480, 90]
      });
    }
  },

  closePanel() {
    this.setData({ selectedStation: null, selectedMarkerId: null });
    this.updateMarkers();
  },

  onTownshipChange(e) {
    const index = Number(e.detail.value);
    const location = resolveTownshipLocation(this.data.townshipOptions[index]);
    app.setLocation(location);
    this.setData({
      ...centerOf(location),
      // 兜底取景；实际视野由 fitTownshipView 按乡镇边界自适应
      scale: index === 0 ? 11 : 13,
      selectedRegionName: location.city,
      townshipIndex: index,
      townshipPolygons: buildTownshipPolygons(location.city),
      selectedStation: null,
      selectedMarkerId: null
    });
    this.updateMarkers();
    this.fitTownshipView(location.city);
  },

  moveToLocation() {
    const location = app.globalData.location;
    this.setData({
      ...centerOf(location),
      scale: location.city === '中方县' ? 11 : 13,
      selectedRegionName: location.city,
      townshipIndex: getTownshipIndex(location),
      townshipPolygons: buildTownshipPolygons(location.city),
      selectedStation: null,
      selectedMarkerId: null
    });
    this.updateMarkers();
    if (location.city !== '中方县') {
      this.fitTownshipView(location.city);
    }
  },

  goToDetail() {
    const { selectedStation } = this.data;
    if (selectedStation) {
      wx.navigateTo({
        url: `/pages/detail/detail?id=${selectedStation.id}`
      });
    }
  }
});
