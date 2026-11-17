# 保留的原生 <button>（待最後整理）

由 `scripts/design-migration/listnative.py` 產生；目前共 **224** 個。分類是啟發式，個別可能歸錯類。

| 類型 | 數量 | 為什麼沒換 | 需要什麼 |
|---|---:|---|---|
| 可選取的文字／圖示小鈕（選中／未選中） | 24 | 文字按鈕規格的 Pressed 只是按住當下，沒有「選中後保持」的狀態；能歸成多選一的已改 SegmentedControl、純圖示的已改 IconButton pressed，剩下的是可複選標籤、預設尺寸、色票、步驟、時間格等。 | 需要「可選取標籤（Chip）」規格（可複選、可移除），或確認哪些可以用 SegmentedControl。 |
| 清單列／卡片（整塊可點） | 49 | 整列、整張卡片可點，用 `<button>` 是為了鍵盤可及；套按鈕外觀會錯。 | 需要「清單列／可選卡片」的選中、滑過、焦點樣式規格。 |
| 拖曳把手／畫布控制點 | 44 | 拖曳、指標事件、畫布座標定位，外觀依畫布元件。 | 多半不需要按鈕規格；可另訂「拖曳把手」小規格。 |
| 選單／下拉選項 | 33 | 已用共用的 menuItemClass／MENU 樣式，但仍是原生 `<button role="option／menuitem">`。 | 需要「選單項目」規格（含勾選、危險項、停用）。 |
| 畫布元件內用 inline style 的按鈕 | 29 | 儀表板畫布元件的顏色、尺寸來自元件設定（使用者可調），不能套固定 token。 | 需要決定：畫布元件是否跟隨設計系統，或維持可自訂外觀。 |
| 下拉／日期／欄位觸發框 | 13 | 外觀是輸入欄位（已套 fieldClass），不是按鈕。 | 屬於欄位規格；目前 fieldClass 已統一。 |
| 頁籤（特殊版型） | 6 | 直式頁籤、帶計數、可雙擊改名的頁籤，共用 Tabs 不支援。 | 需要頁籤規格（直式、徽章、可編輯）。 |
| 其他 | 26 | 逐一判斷後保留：Logo、表頭排序、上傳拖放區、手風琴標題、數字微調 ▴▾、色票觸發、帶徽章的通知鈴、時間輪選項等。 | 各自不同，最後整理時逐項決定。 |

## 可選取的文字／圖示小鈕（選中／未選中）（24）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `features/dashboard/NewPlaneDialog.tsx:54` | {p.label} | — |
| `features/dashboard/PropertiesPanel.tsx:363` | {React.createElement((LucideIcons as | — |
| `features/dashboard/PropertiesPanel.tsx:2855` | {tab.label} | — |
| `features/dashboard/components/DashboardIconPicker.tsx:52` | {set.label} | — |
| `features/dashboard/components/DashboardIconPicker.tsx:79` | {cat.label} | — |
| `features/dashboard/components/DashboardIconPicker.tsx:185` | { (e.target as HTMLImageElement).sty | — |
| `features/dashboard/elements/DataSourcePicker.tsx:134` | {t} | — |
| `features/dispatch-scheduling/DispatchSchedulingPage.tsx:430` | {label} | ArrowUpDown |
| `features/map-editor/components/MapEditorToolbar.tsx:123` | {label} | Icon |
| `features/map-editor/components/MapListDrawer.tsx:224` | {label} | Icon |
| `features/map-editor/components/RouteGroupListView.tsx:372` | {groupVisibility === 'none' ? ( ) :  | EyeOff,Eye |
| `features/schedule-management/components/ScheduleModuleSidebar.tsx:449` | {itemLabel} | Icon |
| `features/schedule-management/components/ScheduleModuleSidebar.tsx:512` | {page.label} | LayoutDashboard |
| `features/shift-deployment/components/ScheduleAdjustDiffStep.tsx:55` | — | ListFilter |
| `features/shift-list/components/RouteRelationGraphEditor.tsx:803` | shiftList.routeRelation.startShort { | — |
| `features/shift-list/components/RouteRelationGraphEditor.tsx:828` | shiftList.routeRelation.endShort {en | — |
| `features/shift-records/components/CustomDateTimePanel.tsx:79` | {String(n).padStart(2, '0')} | — |
| `features/shift-records/components/CustomDateTimePanel.tsx:172` | {cell.day} | — |
| `features/shift-records/components/DateTimeRangePicker.tsx:121` | {startLabel ?? t('shiftRecords.dateR | — |
| `features/shift-records/components/DateTimeRangePicker.tsx:135` | {endLabel ?? t('shiftRecords.dateRan | — |
| `features/time-templates/components/CreateTimeTemplateModal.tsx:119` | {completed ? : item.step} | Check |
| `features/time-templates/components/TimeRangeField.tsx:114` | {startTime ｜｜ '--:--'} | — |
| `features/time-templates/components/TimeRangeField.tsx:124` | {endTime ｜｜ '--:--'} | — |
| `features/vehicle-editor/components/VehiclePreviewTestPanel.tsx:171` | {action.label} | — |

## 清單列／卡片（整塊可點）（49）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `features/access-control/RoleManagementPage.tsx:37` | {module.name} | — |
| `features/dashboard/PropertiesPanel.tsx:1476` | dashboard.properties.plane.fixedScal | — |
| `features/dashboard/PropertiesPanel.tsx:1489` | dashboard.properties.plane.fitWidth  | — |
| `features/dashboard/PropertiesPanel.tsx:1647` | {option.label} | — |
| `features/degraded-operation/DegradedHistoryView.tsx:150` | Level {item.level} {item.name} {hist | StatusBadge |
| `features/degraded-operation/DegradedOperationPage.tsx:398` | Level {plan.level} {plan.name} 速限 {p | Gauge |
| `features/dispatch-scheduling/components/CreateDispatchDialog.tsx:451` | {route.label} {route.stationPathLabe | — |
| `features/maintenance-tasks/components/CreateMaintenanceTaskPage.tsx:130` | {active && ( )} {completed ? : item. | Check |
| `features/maintenance-tasks/components/MaintenanceTaskListPage.tsx:299` | {deletingId === row.task_id ? ( ) :  | Loader2,Trash2 |
| `features/map-editor/components/BasemapFilePickerDialog.tsx:148` | {previewUrl ? ( ) : xodrPreview ? (  | Upload,Image |
| `features/map-editor/components/GeofenceInspectorSection.tsx:205` | {lb.text ｜｜ t('mapEditor.inspector.g | — |
| `features/map-editor/components/MapEditorToolbar.tsx:261` | mapEditor.toolbar.trackCheck {trackI | ScanSearch |
| `features/map-editor/components/MapListDrawer.tsx:95` | {entry.name} {formatListDescription( | — |
| `features/map-editor/components/NewMapPixelDialog.tsx:80` | {t(titleKey)} {t(hintKey)} | — |
| `features/map-editor/components/PointTopologyEditorDialog.tsx:1581` | {nodeDisplayLabel(node.id, node.labe | — |
| `features/map-editor/components/RouteGroupListView.tsx:392` | {open ? ( ) : ( )} {group.displayNam | ChevronDown,ChevronRight |
| `features/map-editor/components/RoutePlanningPanel.tsx:75` | {station.stationName}{' '} ({station | — |
| `features/map-editor/components/RoutePlanningPanel.tsx:323` | {selectedStationLabel ?? (selectable | ChevronDown |
| `features/map-editor/components/TrackDiagnosticsPanel.tsx:49` | {issue.title} {issue.detail} {issue. | — |
| `features/map-editor/components/TrackGenSizeDialog.tsx:1399` | {g.code ｜｜ '—'} {g.members.length} | — |
| `features/map-editor/components/TrajectoryRawDataList.tsx:67` | #{originalIndex} {line} | — |
| `features/map-editor/index.tsx:4816` | mapEditor.chrome.properties | ChevronLeft |
| `features/media-schedules/MediaSchedulesPage.tsx:151` | {schedule.summary} | — |
| `features/psd-control/PsdControlPage.tsx:39` | {title} {doors.map((door) => { const | DoorLinkIndicator |
| `features/schedule-management/components/ScheduleModuleSidebar.tsx:364` | {!collapsed ? ( <> {groupLabel} {can | GroupIcon,ChevronDown |
| `features/scheduled-orders/ScheduledOrdersPage.tsx:495` | {item.display_name} {item.route_name | ListChecks,Route |
| `features/scheduled-orders/ScheduledOrdersPage.tsx:777` | {category.label} {total}筆 | ChevronDown |
| `features/shift-deployment/components/ScheduleAdjustDiffStep.tsx:71` | {option.label} | — |
| `features/shift-deployment/components/SummaryCards.tsx:159` | {event.title} {event.date} {event.le | AlertTriangle |
| `features/shift-list/components/CapacityTrendChart.tsx:223` | {stream.label} {hidden ? ( ) : ( )} | EyeOff,Eye |
| `features/shift-list/components/CreateShiftSchedulePage.tsx:167` | {isStepLockedByInvalidation ? ( ) :  | AlertTriangle,Check |
| `features/shift-list/components/ShiftListPage.tsx:290` | {deletingId === row.shift_id ? ( ) : | Loader2,Trash2 |
| `features/shift-list/components/ShiftListPage.tsx:313` | {duplicatingId === row.shift_id ? (  | Loader2,Copy |
| `features/shift-list/components/ShiftListPage.tsx:327` | {copyingAsManualId === row.shift_id  | Loader2,FilePenLine |
| `features/shift-list/components/StepShiftRouteGroups.tsx:2030` | {cycle.labels.map((label, labelIndex | — |
| `features/shift-records/components/DrivingCapabilityModal.tsx:265` | {/* 內圓疊在軌道線之上；外圈由 NodeHalo 畫在線下 */}  | — |
| `features/system-foundation/components/DataManagementPanel.tsx:204` | {table.name} ~{table.estimated_rows} | — |
| `features/system-foundation/components/SettingsFormControls.tsx:224` | {selected.length === 0 ? ( {placehol | UserRound,IconButton |
| `features/system-foundation/components/SystemFoundationSettingsPanel.tsx:184` | {t(`systemFoundation.sections.${item | — |
| `features/system-foundation/components/ThresholdSettingsDialog.tsx:111` | {selected.length === 0 ? ( systemFou | UserRound,IconButton |
| `features/time-templates/components/CreateTimeTemplateModal.tsx:165` | {active && ( )} {completed ? : item. | Check |
| `features/time-templates/components/TimeTemplateListPage.tsx:307` | {duplicatingId === row.template_id ? | Loader2,Copy |
| `features/time-templates/components/TimeTemplateListPage.tsx:320` | {deletingId === row.template_id ? (  | Loader2,Trash2 |
| `features/vehicle-editor/NewVehicleDialog.tsx:52` | {t(`vehicleEditor.newVehicle.${p.key | — |
| `features/vehicle-editor/components/VehicleAssetPicker.tsx:21` | {url ? ( ) : ( )} {asset.label} | ImageIcon |
| `features/vehicle-editor/management/MapVehicleSettingsPanel.tsx:148` | {row.name} {row.setting ? `${modelNa | — |
| `features/vehicle-run-history/QueryPanel.tsx:342` | {candidate.vehicle?.display_name ??  | — |
| `features/vehicle-run-history/QueryPanel.tsx:361` | {candidate.code} {candidate.trip_cod | — |
| `features/video/VideoHistoryPage.tsx:400` | {active ? : null} {source.name} {[so | Check |

## 拖曳把手／畫布控制點（44）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `features/dashboard/CanvasElement.tsx:1358` | — | Paintbrush |
| `features/dashboard/elements/TabListWidget.tsx:604` | — | — |
| `features/map-editor/components/AssetPaletteBar.tsx:157` | {'src' in icon ? ( ) : ( )} | — |
| `features/map-editor/components/BasemapGraphic.tsx:91` | 更換底圖 | — |
| `features/map-editor/components/BasemapGraphic.tsx:120` | 載入底圖 | Plus |
| `features/map-editor/components/BasemapNode.tsx:979` | {generating ? t('mapEditor.basemap.t | Route |
| `features/map-editor/components/BasemapNode.tsx:1005` | — | Maximize |
| `features/map-editor/components/BasemapNode.tsx:1027` | — | Eraser |
| `features/map-editor/components/BasemapNode.tsx:1045` | — | Rows2 |
| `features/map-editor/components/BasemapNode.tsx:1067` | — | Columns2 |
| `features/map-editor/components/BasemapNode.tsx:1089` | {canReopenCuts ? ( ) : ( )} {canReop | PencilLine,CircleCheck |
| `features/map-editor/components/BasemapNode.tsx:1126` | — | ArrowDownToLine |
| `features/map-editor/components/BasemapNode.tsx:1141` | — | ArrowUpToLine |
| `features/map-editor/components/FacilityDraggableLabel.tsx:330` | — | RotateCw |
| `features/map-editor/components/FacilityNode.tsx:3516` | — | RotateCcw |
| `features/map-editor/components/FacilityNode.tsx:3540` | — | RotateCw |
| `features/map-editor/components/FacilityNode.tsx:3561` | — | RotateCwSquare |
| `features/map-editor/components/FacilityNode.tsx:3573` | — | Paintbrush |
| `features/map-editor/components/FacilityNode.tsx:3593` | — | LayoutGrid |
| `features/map-editor/components/FacilityNode.tsx:3609` | — | Trash2 |
| `features/map-editor/components/GeofenceNode.tsx:627` | — | Plus |
| `features/map-editor/components/GeofenceNode.tsx:779` | — | Paintbrush |
| `features/map-editor/components/GeofenceNode.tsx:794` | — | Trash2 |
| `features/map-editor/components/GeofenceNode.tsx:913` | — | RotateCw |
| `features/map-editor/components/PointTopologyEditorDialog.tsx:1859` | {displayLabel} {field ? ( X {field.x | — |
| `features/map-editor/components/PointTopologyEditorDialog.tsx:1936` | — | — |
| `features/map-editor/components/PointTopologyEditorDialog.tsx:1964` | — | — |
| `features/map-editor/components/PointTopologyEditorDialog.tsx:1985` | — | — |
| `features/map-editor/components/TrackGenGraphic.tsx:120` | mapEditor.trackGen.graphic.loadTitle | Plus |
| `features/map-editor/components/TrackGenGraphic.tsx:326` | mapEditor.trackGen.graphic.replace | — |
| `features/media-groups/MediaGroupsPage.tsx:409` | — | GripVertical |
| `features/media-schedules/ScheduleEditorDialog.tsx:408` | — | GripVertical |
| `features/shift-list/components/ManualScheduleEditorSidebar.tsx:67` | {label} | — |
| `features/shift-list/components/RouteRelationGraphEditor.tsx:1140` | — | — |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1619` | — | Trash2 |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1638` | — | CopyPlus |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1690` | {moveCardPrefix ?? '·'} | Info |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1718` | — | AlertTriangle |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1751` | — | Info |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1778` | — | Info |
| `features/shift-list/components/StepShiftRouteGroups.tsx:346` | — | GripVertical |
| `features/time-templates/components/StepTaskScheduling.tsx:810` | — | Trash2 |
| `features/vehicle-editor/ComponentPalette.tsx:18` | {item.label} | — |
| `features/virtual-fence-management/components/FenceShapeOverlay.tsx:132` | — | — |

## 選單／下拉選項（33）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `components/SiteMultiSelect.tsx:97` | {allLabel} {values.length === 0 ? :  | Check |
| `components/SiteMultiSelect.tsx:112` | {option.label} {option.badge !== und | CheckboxIndicator |
| `components/SiteSelect.tsx:137` | {option.label} {option.badge ? {opti | Check |
| `features/access-control/AccountManagementPage.tsx:40` | svg]:size-4">{icon} {label} | — |
| `features/access-control/RoleManagementPage.tsx:42` | 編輯 | Pencil |
| `features/access-control/RoleManagementPage.tsx:42` | 刪除 | Trash2 |
| `features/dashboard/DashboardList.tsx:216` | 開啟編輯 | FolderOpen |
| `features/dashboard/DashboardList.tsx:228` | 顯示模式改為{fitWidth ? t('dashboard.listP | Maximize2 |
| `features/dashboard/DashboardList.tsx:244` | common.delete | Trash2 |
| `features/dashboard/components/CanvasChildListPortal.tsx:108` | {getWidgetDisplayName(child)} {getWi | — |
| `features/dispatch-scheduling/components/VehicleAssignSelect.tsx:108` | {code} | VehicleStatusPill |
| `features/map-editor/components/MapLibraryPage.tsx:615` | mapLibrary.importFromFile | FolderOpen |
| `features/map-editor/components/MapLibraryPage.tsx:627` | mapLibrary.pasteFile | FileText |
| `features/map-editor/components/MapLibraryPage.tsx:639` | mapLibrary.loadFromServer | Server |
| `features/map-editor/components/MapLibraryPage.tsx:838` | mapLibrary.openTitle | FolderOpen |
| `features/map-editor/components/MapLibraryPage.tsx:851` | mapLibrary.setActive | MapPin |
| `features/map-editor/components/MapLibraryPage.tsx:865` | mapLibrary.renameTitle | Pencil |
| `features/map-editor/components/MapLibraryPage.tsx:877` | mapLibrary.duplicateTitle | Copy |
| `features/map-editor/components/MapLibraryPage.tsx:889` | mapLibrary.exportTitle | Download |
| `features/map-editor/components/MapLibraryPage.tsx:901` | common.delete | Trash2 |
| `features/shift-list/components/StepShiftActionSettings.tsx:301` | {group.typeLabel} | ChevronRight |
| `features/shift-list/components/StepShiftActionSettings.tsx:339` | {activeGroup.generalLabel} | — |
| `features/shift-list/components/StepShiftActionSettings.tsx:351` | {activeGroup.category === 'facility_ | ChevronRight |
| `features/shift-list/components/StepShiftActionSettings.tsx:404` | {facility.name} | — |
| `features/system-foundation/components/SettingsFormControls.tsx:257` | {item.name} | CheckboxIndicator,UserRound |
| `features/system-foundation/components/ThresholdSettingsDialog.tsx:148` | {person.name} | CheckboxIndicator,UserRound |
| `features/vehicle-registry/VehicleRegistryPage.tsx:33` | svg]:size-4">{icon} {text} | — |
| `features/video/SourcePicker.tsx:91` | {o.name} {o.vehicleCode ? {o.vehicle | Check |
| `features/video/VideoMonitorPage.tsx:246` | {label as string} | — |
| `features/video/VideoResourcesPage.tsx:30` | 編輯 | Pencil |
| `features/video/VideoResourcesPage.tsx:31` | 複製 | Copy |
| `features/video/VideoResourcesPage.tsx:32` | 查看影像紀錄 | Film |
| `features/video/VideoResourcesPage.tsx:33` | 刪除 | Trash2 |

## 畫布元件內用 inline style 的按鈕（29）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `components/SiteColorInput.tsx:66` | — | — |
| `features/dashboard/CanvasElement.tsx:525` | — | List |
| `features/dashboard/CanvasElement.tsx:643` | {tab.label} 子畫布 | Edit3 |
| `features/dashboard/CanvasElement.tsx:882` | — | Trash2 |
| `features/dashboard/CanvasElement.tsx:1378` | — | Trash2 |
| `features/dashboard/ComponentPalette.tsx:105` | {label} | — |
| `features/dashboard/PlaneWorkspace.tsx:521` | — | ZoomOut |
| `features/dashboard/PlaneWorkspace.tsx:534` | {Math.round(userZoom * 100)}% | Crosshair |
| `features/dashboard/PlaneWorkspace.tsx:541` | — | ZoomIn |
| `features/dashboard/PlaneWorkspace.tsx:554` | {scaleLocked ? : } | Lock,LockOpen |
| `features/dashboard/PlaneWorkspace.tsx:566` | — | ChevronsDownUp |
| `features/dashboard/PlaneWorkspace.tsx:577` | — | ChevronsUpDown |
| `features/dashboard/PlaneWorkspace.tsx:739` | dashboard.planeWorkspace.gateSetting | — |
| `features/dashboard/components/SimulationTransportToolbar.tsx:202` | dashboard.simulation.title | SlidersHorizontal |
| `features/dashboard/elements/ShiftListWidget.tsx:280` | 查看詳情 | ExternalLink |
| `features/dashboard/elements/ShiftListWidget.tsx:388` | {label} | — |
| `features/dashboard/elements/TabListWidget.tsx:435` | {tab.label} | — |
| `features/dashboard/elements/TabListWidget.tsx:577` | — | Edit3 |
| `features/dashboard/index.tsx:1229` | {saveStatus === 'ok' ? t('dashboard. | Save |
| `features/map-editor/components/PointTopologyEditorDialog.tsx:1517` | {listOpen ? t('mapEditor.pointTopolo | — |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx:1018` | — | — |
| `features/time-templates/components/ScheduleIntervalSelection.tsx:124` | — | — |
| `features/time-templates/components/TimeOfDayPicker.tsx:245` | {displayText} | — |
| `features/time-templates/components/TimeSlotAttributeCard.tsx:146` | — | Check |
| `features/time-templates/components/TimeSlotAttributeCard.tsx:230` | — | MoreHorizontal |
| `features/time-templates/components/TimeSlotIntervalsPanel.tsx:374` | — | Check |
| `features/time-templates/components/TimeSlotIntervalsPanel.tsx:388` | — | Pencil |
| `features/time-templates/components/TimeSlotIntervalsPanel.tsx:398` | — | Trash2 |
| `features/virtual-fence-management/components/FenceShapeOverlay.tsx:149` | — | Plus |

## 下拉／日期／欄位觸發框（13）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `components/SiteColorInput.tsx:42` | — | Pipette |
| `components/SiteDateTimeInput.tsx:100` | {displayDateTimeValue(current, type) | Clock,CalendarClock |
| `components/SiteMultiSelect.tsx:55` | {triggerLabel ?? summary} | ChevronDown |
| `components/SiteSelect.tsx:94` | {selected?.label ?? (selectedValue ｜ | ChevronDown |
| `features/degraded-operation/ExecutionScheduleFields.tsx:47` | {value ｜｜ "--:--"} | Clock |
| `features/dispatch-scheduling/components/VehicleAssignSelect.tsx:72` | {value ? ( <> {value} {selectedStatu | VehicleStatusPill,ChevronDown |
| `features/map-editor/components/MapLibraryPage.tsx:813` | — | MoreHorizontal |
| `features/schedule-management/components/ShellAccountToolbar.tsx:80` | {auth.loading ? '讀取中…' : auth.user?. | User,ChevronDown |
| `features/shift-deployment/components/ExecutionTimeField.tsx:183` | {value ｜｜ placeholder} | — |
| `features/shift-list/components/StepShiftActionSettings.tsx:239` | {displayLabel} | ChevronDown |
| `features/shift-list/components/StepShiftScheduleAdjust.tsx:606` | {meta.groupTitle} {isError ? t('shif | Info,ChevronDown |
| `features/video/SourcePicker.tsx:47` | {selected?.name ?? placeholder} | ChevronDown |
| `features/video/VideoHistoryPage.tsx:318` | {selectedNames.length ? selectedName | — |

## 頁籤（特殊版型）（6）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `features/map-editor/components/WorkspaceTabs.tsx:19` | mapEditor.tabMap | — |
| `features/map-editor/components/WorkspaceTabs.tsx:32` | mapEditor.tabTrajectory | — |
| `features/map-editor/index.tsx:4200` | {label} | — |
| `features/vehicle-editor/management/VehicleModelManagement.tsx:74` | {label} | — |
| `features/vehicle-rotation/VehicleRotationPage.tsx:628` | {item.label} {item.count ? {item.cou | — |
| `features/video/VideoMonitorPage.tsx:229` | {tab.name} {tab.tileCount} 格 | — |

## 其他（26）

| 位置 | 內容 | 圖示 |
|---|---|---|
| `features/access-control/AccountDialogs.tsx:23` | {role.name} | — |
| `features/dashboard/components/BindingIssuesBar.tsx:12` | {isChecking ? : } {isChecking ? '檢查連 | RefreshCw,AlertTriangle |
| `features/dashboard/elements/DataSourcePicker.tsx:122` | {selectedTable ｜｜ (loadingTables ? t | ChevronDown |
| `features/map-editor/components/AssetPaletteBar.tsx:127` | mapEditor.palette.library | KeyboardArrowLeft |
| `features/map-editor/components/MapListDrawer.tsx:395` | mapEditor.listDrawer.palette | KeyboardArrowRight |
| `features/map-editor/components/RouteGroupListView.tsx:235` | {isVisible && topologyAvailable ? (  | Eye,EyeOff |
| `features/map-editor/index.tsx:4649` | — | ChevronRight |
| `features/media-content/MediaContentPage.tsx:56` | 點擊或拖曳文件至此區域即可上傳 {type==='audio'?'MP3 | Upload |
| `features/media-groups/MediaGroupsPage.tsx:116` | 分組名稱 | ArrowDownUp |
| `features/media-schedules/MediaSchedulesPage.tsx:161` | {targets} | — |
| `features/schedule-management/components/ScheduleModuleSidebar.tsx:285` | — | VtmsMark |
| `features/schedule-management/components/ScheduleModuleSidebar.tsx:296` | VTMS | VtmsMark |
| `features/schedule-management/components/ShellAccountToolbar.tsx:66` | {notificationCount > 0 ? ( {notifica | Bell |
| `features/scheduled-orders/ScheduledOrdersPage.tsx:137` | {group} | ChevronDown |
| `features/shift-deployment/components/ExecutionTimeField.tsx:75` | {format(item)} | — |
| `features/shift-deployment/components/VehicleControlSection.tsx:18` | 載具控制 | ChevronUp |
| `features/shift-list/components/HelpTip.tsx:53` | — | Info |
| `features/shift-records/components/DateTimeRangePicker.tsx:147` | — | — |
| `features/system-foundation/components/SettingsFormControls.tsx:110` | ▴ | — |
| `features/system-foundation/components/SettingsFormControls.tsx:118` | ▾ | — |
| `features/system-foundation/components/ThresholdSettingsDialog.tsx:64` | ▴ | — |
| `features/system-foundation/components/ThresholdSettingsDialog.tsx:72` | ▾ | — |
| `features/time-templates/components/AttributeColorPalette.tsx:32` | {selected && } | Check |
| `features/time-templates/components/TimeOfDayPicker.tsx:68` | {pad2(n)} | — |
| `features/time-templates/components/TimeSlotAttributeCard.tsx:63` | — | — |
| `features/vehicle-editor/VehicleList.tsx:141` | {v.name} | Bus |

# 保留的寫死色值（hex／rgb()）

共 **1794** 處。能對應設計 token 的已由 `codemod-design-tokens.mjs --families` 換掉；下面這些是資料或繪圖用色，要先決定「畫布元件／範本是否跟著設計系統走」。

| 類型 | 處數 | 檔案數 |
|---|---:|---:|
| 儀表板畫布元件（顏色來自元件設定） | 483 | 26 |
| 儀表板範本／示範資料（存成資料的顏色） | 337 | 10 |
| 畫布／SVG／圖表繪圖色 | 336 | 54 |
| 儀表板編輯器（多為設定面板的色票與預設值） | 281 | 23 |
| 其他（逐檔判斷） | 192 | 49 |
| 元件或屬性的預設色（使用者可改，存進設定） | 165 | 6 |

## 儀表板畫布元件（顏色來自元件設定）

| 檔案 | 處數 |
|---|---:|
| `features/dashboard/CanvasElement.tsx` | 90 |
| `features/dashboard/elements/UnitTelemetryCardWidget.tsx` | 51 |
| `features/dashboard/ComponentPalette.tsx` | 41 |
| `features/dashboard/elements/RouteProgressWidget.tsx` | 39 |
| `features/dashboard/elements/ShiftListWidget.tsx` | 37 |
| `features/dashboard/elements/LineChartWidget.tsx` | 32 |
| `features/dashboard/elements/TabListWidget.tsx` | 25 |
| `features/dashboard/elements/GaugeWidget.tsx` | 24 |
| `features/dashboard/elements/MaintenanceDistributionWidget.tsx` | 18 |
| `features/dashboard/elements/SlotGridWidget.tsx` | 18 |
| `features/dashboard/elements/BarChartWidget.tsx` | 17 |
| `features/dashboard/elements/GroupCanvasRenderer.tsx` | 15 |
| `features/dashboard/elements/DatabaseWidget.tsx` | 14 |
| `features/dashboard/elements/EmptyStateWidget.tsx` | 10 |
| `features/dashboard/elements/ImageWidget.tsx` | 7 |
| `features/dashboard/elements/VehicleAlertBannerWidget.tsx` | 7 |
| `features/dashboard/elements/SegmentBarWidget.tsx` | 6 |
| `features/dashboard/elements/gaugeBand.ts` | 6 |
| `features/dashboard/elements/lineChartSeries.ts` | 6 |
| `features/dashboard/elements/ProgressBarWidget.tsx` | 5 |
| `features/dashboard/elements/StatCardWidget.tsx` | 4 |
| `features/dashboard/elements/WidgetRenderer.tsx` | 4 |
| `features/dashboard/elements/chartAxis.ts` | 4 |
| `features/dashboard/elements/ClockWidget.tsx` | 1 |
| `features/dashboard/elements/StatusBadgeWidget.tsx` | 1 |
| `features/dashboard/elements/VehicleContainerWidgetView.tsx` | 1 |

## 儀表板範本／示範資料（存成資料的顏色）

| 檔案 | 處數 |
|---|---:|
| `features/dashboard/constants/demoPlane.ts` | 128 |
| `features/dashboard/constants/deploymentPlane.ts` | 98 |
| `features/dashboard/constants/demoSql.ts` | 43 |
| `features/dashboard/constants/mapPlatformTheme.ts` | 22 |
| `features/dashboard/constants/alertBannerDemoRules.ts` | 15 |
| `features/dashboard/constants/vehicleMonitorTheme.ts` | 9 |
| `features/dashboard/constants/healthStatusTheme.ts` | 8 |
| `features/dashboard/constants/severityTheme.ts` | 6 |
| `features/vehicle-editor/constants/palette.ts` | 6 |
| `features/vehicle-editor/constants/userRestoredVtmsVehicle.ts` | 2 |

## 畫布／SVG／圖表繪圖色

| 檔案 | 處數 |
|---|---:|
| `features/shift-list/components/RouteRelationGraphEditor.tsx` | 34 |
| `features/map-editor/components/FacilityNode.tsx` | 28 |
| `features/map-editor/components/SimRoutePathOverlay.tsx` | 27 |
| `features/map-editor/components/TrackGenSizeDialog.tsx` | 25 |
| `features/map-editor/components/PointTopologyEditorDialog.tsx` | 23 |
| `features/map-editor/components/RoutePlanningOverlay.tsx` | 11 |
| `features/map-editor/components/TrajectoryLayer.tsx` | 11 |
| `features/map-editor/components/MapListDrawer.tsx` | 10 |
| `features/shift-list/components/CapacityTrendChart.tsx` | 10 |
| `features/map-editor/utils/trackGenLayout.ts` | 9 |
| `features/map-editor/components/AreaNode.tsx` | 8 |
| `features/map-editor/components/SignalLightGraphic.tsx` | 8 |
| `features/map-editor/opendrive/lanePolygons.ts` | 8 |
| `features/map-editor/components/MapPixelFrameOverlay.tsx` | 7 |
| `features/map-editor/components/AreaDragTrack.tsx` | 6 |
| `features/map-editor/components/AreaRulerOverlay.tsx` | 6 |
| `features/map-editor/index.tsx` | 6 |
| `features/map-editor/utils/mqttColorSimulation.ts` | 6 |
| `features/map-editor/utils/trackGenGroups.ts` | 6 |
| `features/map-editor/vehicles/MapAreaVehicleOverlay.tsx` | 6 |
| `features/map-editor/vehicles/defaultMapVehicleIcon.ts` | 6 |
| `features/map-editor/components/GeofenceNode.tsx` | 5 |
| `features/map-editor/utils/geofence.ts` | 5 |
| `features/map-editor/utils/pointTopology.ts` | 5 |
| `features/map-editor/components/BasemapGridOverlay.tsx` | 4 |
| `features/map-editor/components/MapAreaCanvas.tsx` | 4 |
| `features/map-editor/components/PlatformDoorGraphic.tsx` | 4 |
| `features/map-editor/vehicles/vehicleRoofIndicator.ts` | 4 |
| `features/map-editor/components/AreaInspectorSection.tsx` | 3 |
| `features/map-editor/components/MapCanvas.tsx` | 3 |
| `features/map-editor/components/TrackGenGraphic.tsx` | 3 |
| `features/map-editor/utils/trackFacility.ts` | 3 |
| `features/vehicle-editor/elements/VehicleDoorSvg.tsx` | 3 |
| `features/map-editor/components/FrameInspectorSection.tsx` | 2 |
| `features/map-editor/components/Inspector.tsx` | 2 |
| `features/map-editor/components/MapCropModeOverlay.tsx` | 2 |
| `features/map-editor/components/MapLibraryPage.tsx` | 2 |
| `features/map-editor/components/MapRulers.tsx` | 2 |
| `features/map-editor/components/RoutePlanningPanel.tsx` | 2 |
| `features/map-editor/utils/crossTrackPortals.ts` | 2 |
| `features/map-editor/utils/facilityArea.ts` | 2 |
| `features/dashboard/vehicle-operation-actions/VehicleBodySvg.tsx` | 1 |
| `features/map-editor/components/BasemapNode.tsx` | 1 |
| `features/map-editor/components/FacilityDraggableLabel.tsx` | 1 |
| `features/map-editor/components/FacilityInspectorSection.tsx` | 1 |
| `features/map-editor/components/FillColorRulesSection.tsx` | 1 |
| `features/map-editor/components/MapAuxiliaryLinesOverlay.tsx` | 1 |
| `features/map-editor/components/RouteGroupListView.tsx` | 1 |
| `features/map-editor/components/ZonePartitionInspectorSection.tsx` | 1 |
| `features/map-editor/utils/facilityLabelStyle.ts` | 1 |
| `features/map-editor/utils/roadLineFacility.ts` | 1 |
| `features/map-editor/utils/zonePartition.ts` | 1 |
| `features/map-editor/vehicles/VehicleTrackProgressBadge.tsx` | 1 |
| `features/map-editor/vehicles/resolveMapVehicleAppearance.ts` | 1 |

## 儀表板編輯器（多為設定面板的色票與預設值）

| 檔案 | 處數 |
|---|---:|
| `features/dashboard/PropertiesPanel.tsx` | 82 |
| `features/dashboard/PlaneWorkspace.tsx` | 58 |
| `features/dashboard/route-progress/RouteTrackView.tsx` | 17 |
| `features/dashboard/utils/mainlineTaskModel.ts` | 15 |
| `features/dashboard/utils/maintenanceTaskModel.ts` | 12 |
| `features/dashboard/components/CanvasChildListPortal.tsx` | 11 |
| `features/dashboard/components/EditPreviewChrome.tsx` | 11 |
| `features/dashboard/utils/resolveVehicleMonitorBadge.ts` | 11 |
| `features/dashboard/index.tsx` | 10 |
| `features/dashboard/utils/operationStatusBadge.ts` | 10 |
| `features/dashboard/route-progress/RouteProgressSettings.tsx` | 6 |
| `features/dashboard/components/LayoutValidationIcon.tsx` | 5 |
| `features/dashboard/utils/migrateDashboardPlane.ts` | 5 |
| `features/dashboard/utils/migrateVehicleMonitorProtocol.ts` | 5 |
| `features/dashboard/utils/migrateWidgetGenerics.ts` | 4 |
| `features/dashboard/utils/shiftCardTemplates.ts` | 4 |
| `features/dashboard/components/BindingWarningIcon.tsx` | 3 |
| `features/dashboard/route-progress/RouteVehicleMarker.tsx` | 3 |
| `features/dashboard/utils/alertTrigger.ts` | 3 |
| `features/dashboard/DashboardList.tsx` | 2 |
| `features/dashboard/useDashboardEditor.ts` | 2 |
| `features/dashboard/components/SnapGuideLines.tsx` | 1 |
| `features/dashboard/utils/vehicleInfoCardTemplate.ts` | 1 |

## 其他（逐檔判斷）

| 檔案 | 處數 |
|---|---:|
| `features/shift-list/utils/scheduleEngineLastIssues.ts` | 21 |
| `features/shift-list/components/ShiftSchedulePlanGrid.tsx` | 20 |
| `components/SiteColorInput.tsx` | 13 |
| `features/shift-records/components/DrivingCapabilityModal.tsx` | 13 |
| `features/shift-deployment/diffScheduleTasks.ts` | 11 |
| `features/shift-list/utils/buildCapacityTrend.ts` | 8 |
| `features/vehicle-editor/VehicleWorkspace.tsx` | 8 |
| `features/time-templates/components/StepOverallPreview.tsx` | 7 |
| `features/psd-control/components/DoorLinkIndicator.tsx` | 6 |
| `features/shift-deployment/fallback.ts` | 6 |
| `features/degraded-operation/DegradedOperationPage.tsx` | 5 |
| `features/shift-deployment/components/ShiftRouteTrack.tsx` | 5 |
| `features/shift-deployment/components/SummaryCards.tsx` | 5 |
| `features/dispatch-scheduling/components/VehicleAssignSelect.tsx` | 4 |
| `features/shift-list/components/StepShiftRouteGroups.tsx` | 4 |
| `features/time-templates/components/AttributeColorPalette.tsx` | 4 |
| `features/psd-control/components/DoorMonitorCard.tsx` | 3 |
| `features/time-templates/components/StepTaskScheduling.tsx` | 3 |
| `features/time-templates/components/TimeSlotIntervalsPanel.tsx` | 3 |
| `features/degraded-operation/DegradedHistoryView.tsx` | 2 |
| `features/degraded-operation/DegradedPlanDialog.tsx` | 2 |
| `features/degraded-operation/PlanManagementView.tsx` | 2 |
| `features/shift-deployment/components/DeploymentShiftTable.tsx` | 2 |
| `features/shift-deployment/components/RingProgress.tsx` | 2 |
| `features/shift-deployment/hooks/useDeploymentData.ts` | 2 |
| `features/shift-list/components/CreateShiftSchedulePage.tsx` | 2 |
| `features/shift-list/components/StepShiftActionSettings.tsx` | 2 |
| `features/time-templates/components/CreateTimeTemplateModal.tsx` | 2 |
| `features/time-templates/components/ScheduleIntervalSelection.tsx` | 2 |
| `features/time-templates/components/VehicleCapacitySlider.tsx` | 2 |
| `features/vehicle-rotation/VehicleRotationPage.tsx` | 2 |
| `features/virtual-fence-management/components/FenceShapeOverlay.tsx` | 2 |
| `features/degraded-operation/ActiveExecutionDialogs.tsx` | 1 |
| `features/degraded-operation/DegradedPlanForm.tsx` | 1 |
| `features/dispatch-scheduling/DispatchSchedulingPage.tsx` | 1 |
| `features/maintenance-tasks/components/CreateMaintenanceTaskPage.tsx` | 1 |
| `features/psd-control/PsdControlPage.tsx` | 1 |
| `features/shift-deployment/components/ExecutionTimeField.tsx` | 1 |
| `features/shift-records/components/DateTimeRangePicker.tsx` | 1 |
| `features/time-templates/components/TimeOfDayPicker.tsx` | 1 |
| `features/time-templates/components/scheduleTimelineBackground.tsx` | 1 |
| `features/vehicle-editor/elements/VehicleElementNode.tsx` | 1 |
| `features/vehicle-editor/elements/VehicleImageLayer.tsx` | 1 |
| `features/vehicle-editor/useVehicleEditor.ts` | 1 |
| `features/vehicle-editor/utils/bodyColor.ts` | 1 |
| `features/vehicle-editor/utils/colorInput.ts` | 1 |
| `features/vehicle-editor/utils/createElement.ts` | 1 |
| `features/virtual-fence-management/components/FenceListPanel.tsx` | 1 |
| `styles/tokens.ts` | 1 |

## 元件或屬性的預設色（使用者可改，存進設定）

| 檔案 | 處數 |
|---|---:|
| `features/dashboard/types.ts` | 96 |
| `features/time-templates/types/editor.ts` | 56 |
| `features/shift-records/types.ts` | 6 |
| `features/dispatch-scheduling/types.ts` | 4 |
| `features/shift-list/types.ts` | 2 |
| `features/virtual-fence-management/types.ts` | 1 |
