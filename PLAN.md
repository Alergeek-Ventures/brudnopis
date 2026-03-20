# Notes App - Desloppification Plan

## Architectural Principles

1. **React is purely presentational** — components render what the state machines tell them
2. **All orchestration lives in state machines** — XState for complex flows, TanStack Query for server/external state
3. **No useEffects for business logic** — effects are violations, documented as such
4. **Refs in XState context is a documented violation** — stroke data mutates aggressively, refs prevent re-renders
5. **No silent failures** — every error surfaces to user or logs

---

## Current State Analysis

### What's Working
- Two XState machines manage note lifecycle: `noteLifecycleMachine` (parent) and `noteMachine` (child)
- SVG serialization/deserialization round-trips correctly
- Native Onyx SDK integration works for low-latency stylus input
- Document list with thumbnails renders properly

### Critical Issues Being Addressed

#### 1. Parent-Child Machine Complexity
**Location:** `src/features/recognition/machine.ts` + `note-machine.ts`

**Problem:** Events proxied through parent (`STROKE_END` → parent → child) making flow hard to trace. Parent adds no value, just forwards events.

**Solution:** Merge into single machine.

#### 2. SAF URI Handling is Brittle
**Location:** `src/features/storage/utilities/storage.ts:114-143`

**Problem:** Manual regex-based encoding/decoding at every call site.

**Solution:** Migrate to `expo-file-system/next` which handles normalization internally.

#### 3. Regex-Based SVG Parsing
**Location:** `src/features/svg/utilities/svg-parser.ts:30-70`

**Problem:** Uses regex to parse XML. Documented as "constraint" but will break on edge cases.

**Status:** **DEFERRED TO LATER**

#### 4. Race Condition: CANVAS_READY vs SVG Load
**Location:** `src/features/recognition/note-machine.ts:235-285`

**Problem:** `loading` state waits for both SVG load and canvas ready, transitions depend on which finishes first.

**Status:** **DEFERRED TO LATER** — will properly rethink loading states

#### 5. Mixed Concerns in Canvas Component
**Location:** `src/features/canvas/components/canvas.tsx` (199 lines)

**Problem:** UI rendering, refs, machine interaction, event handlers all mixed.

**Solution:** Machine is the orchestrator. Canvas component is pure UI, reads machine snapshot, sends events.

---

## Decisions Made

### 1. State Machine Architecture: Single Machine
**Decision:** Merge `noteMachine` into `noteLifecycleMachine`

**Rationale:** Parent doesn't add value, just proxies events. Single machine is simpler to trace and debug.

### 2. SAF URI Handling: expo-file-system/next
**Decision:** Migrate to new `File`/`Directory` API

**Rationale:** Handles URI normalization internally, cleaner than wrapper around old API.

### 3. SVG Parsing: Deferred
**Decision:** Keep regex parser for now

**Rationale:** Will do full AST-based rewrite later when prioritized.

### 4. Canvas Component: No Hook
**Decision:** Machine is the hook. Canvas component is pure UI.

**Rationale:** If machine contains all state, component just renders snapshot.

### 5. Loading Race Condition: Deferred
**Decision:** Keep current loading/waitingForCanvas states

**Rationale:** Will properly rethink this later when redesigning loading states.

### 6. Refs in Context: Documented Violation
**Decision:** Keep refs in XState context

**Rationale:** Strokes mutate aggressively during drawing, refs prevent re-renders. Document as intentional violation.

---

## Target Architecture

```
Single noteMachine (merged from noteLifecycle + note)
├── idle
│   └── OPEN_NOTE → loading
├── loading
│   ├── Load SVG (async)
│   ├── Wait for CANVAS_READY
│   └── Both complete → restoring
├── restoring
│   ├── restoreAndStart actor
│   └── onDone → editing
├── editing
│   ├── clean (no unsaved changes)
│   └── dirty (has unsaved changes)
│       ├── STROKE_END/ERASE_END → dirty (reenter)
│       └── after SAVE_DEBOUNCE_MS → saving
├── saving
│   ├── serializeAndSave actor
│   └── onDone → editing.clean
├── flushing (save before close)
│   ├── serializeAndSave actor
│   └── onDone → stopping
├── stopping
│   ├── stopAndRefresh actor
│   └── onDone → closed (final)
└── closed
    └── onDone output → triggers navigation + recognition

recognizing (runs after navigation, async)
├── loading → load SVG
├── processing → recognize strokes
└── persisting → save metadata
```

---

## Implementation Plan

### Phase 1: Machine Consolidation

#### 1.1 Merge noteMachine into noteLifecycleMachine
**Files to modify:**
- `src/features/recognition/machine.ts` — expand with noteMachine states
- `src/features/recognition/note-machine.ts` — **DEPRECATE** (keep until confirmed working)
- `src/features/recognition/atoms.ts` — update atom initialization

**Changes:**
- Inline all `noteMachine` states into `noteLifecycleMachine`
- Remove `noteMachine` actor from setup
- Remove `sendTo('noteEditor', ...)` proxies
- Handle events directly in merged machine
- Keep refs in context (documented violation)

**Machine context:**
```typescript
context: {
  // Note identification
  fileUri: string | null;
  folderUri: string | null;
  lang: string;
  
  // Canvas config
  width: number;
  height: number;
  backgroundPattern: BackgroundPattern;
  
  // DOCUMENTED VIOLATION: React refs stored in XState context
  // Rationale: strokesRef mutates aggressively (every stylus point)
  // Storing in context prevents re-renders while allowing machine actions
  // to access current stroke data for serialization
  strokesRef: MutableRefObject<Stroke[]>;
  canvasRef: MutableRefObject<DrawingCanvasRef | null>;
  
  // State
  loadedStrokes: Stroke[];  // temp between load and restore
  canvasReady: boolean;
  
  // Recognition
  results: Map<string, RecognitionResult>;
  svg: string | null;  // transient
  recognizedText: string | null;  // transient
}
```

#### 1.2 Update Event Types
**Remove proxied events:**
- `STROKE_END`, `ERASE_END` go directly to editing state
- `CANVAS_READY` goes to loading state
- `CLOSE_NOTE` triggers save + close flow
- `TOOLBAR_EXPANDED/COLLAPSED` pause/resume drawing

#### 1.3 Update Canvas Component
**File:** `src/features/canvas/components/canvas.tsx`

**Simplify to:**
```typescript
export function Canvas() {
  const { fileUri, folderUri } = useLocalSearchParams<...>();
  const [snapshot, send] = useAtom(noteLifecycleMachineAtom);
  const activeLanguage = useAtomValue(activeLanguageAtom);
  
  // Refs - not in machine context, passed via OPEN_NOTE
  const canvasRef = useRef<DrawingCanvasRef>(null);
  const strokesRef = useRef<Stroke[]>([]);
  
  // VIOLATION: BackHandler in useEffect
  // Rationale: BackHandler requires subscription lifecycle
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);
  
  // Send OPEN_NOTE on mount / fileUri change
  // NOTE: This is orchestration, but we accept it here
  useEffect(() => {
    send({
      type: 'OPEN_NOTE',
      fileUri: fileUri ?? null,
      folderUri: folderUri ?? null,
      lang: activeLanguage,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundPattern: BACKGROUND_PATTERN,
      strokesRef,
      canvasRef,
    });
  }, [fileUri, folderUri, activeLanguage]);
  
  // Render based on snapshot
  const isSaving = snapshot.matches('flushing') || snapshot.matches('stopping');
  
  return (
    <View className="flex-1 bg-white">
      <DrawingCanvasView
        ref={canvasRef}
        // ...props
        onReady={() => send({ type: 'CANVAS_READY' })}
        onStrokeEnd={(e) => send({ type: 'STROKE_END', ... })}
        onEraseEnd={(e) => send({ type: 'ERASE_END', ... })}
      />
      <Toolbar 
        onClose={() => send({ type: 'CLOSE_NOTE' })}
        onExpandedChange={(expanded) => 
          send({ type: expanded ? 'TOOLBAR_EXPANDED' : 'TOOLBAR_COLLAPSED' })
        }
      />
      {isSaving && <SavingOverlay />}
    </View>
  );
}
```

**Wait** — the user said React should not orchestrate. Sending OPEN_NOTE in useEffect is orchestration.

Alternative: Canvas component reads params, machine atom reads params via hook? Or we accept this one useEffect as necessary for initialization?

Actually, looking back at original code:
```typescript
// Send OPEN_NOTE synchronously during render (not in an effect).
// The machine is idempotent for same fileUri/folderUri
```

So original was render-time, not useEffect. Keep that pattern? Or move to useEffect?

User said "No useEffects for business logic" but also "BackHandler can be in useEffect". OPEN_NOTE is business logic initialization.

I think we keep render-time OPEN_NOTE (current pattern) and only use useEffect for BackHandler. This minimizes violations.

### Phase 2: expo-file-system/next Migration

#### 2.1 Install/Update
```bash
npm install expo-file-system@latest
```

#### 2.2 Create New Storage Module
**File:** `src/features/storage/utilities/storage-v2.ts`

**API:**
```typescript
import { File, Directory, Paths } from 'expo-file-system';

export async function pickFolder(initialUri?: string): Promise<string | null> {
  const result = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
  if (!result.granted) return null;
  await AsyncStorage.setItem(FOLDER_URI_KEY, result.directoryUri);
  return result.directoryUri;
}

export async function listDocuments(folderUri: string): Promise<DocumentInfo[]> {
  // Use new Directory API
  const dir = new Directory(folderUri);
  const entries = await dir.list();
  
  const svgFiles = entries
    .filter(entry => entry instanceof File && entry.name.endsWith('.svg'))
    .map(entry => entry as File);
  
  // Read metadata from each file
  const docs = await Promise.all(
    svgFiles.map(async (file) => {
      const filename = file.name;
      let recognizedText: string | undefined;
      let svgContent: string | undefined;
      
      try {
        svgContent = await file.text();
        recognizedText = extractMetadataText(svgContent);
      } catch (err) {
        console.error(`Failed to read ${filename}:`, err);
      }
      
      return {
        uri: file.uri,
        filename,
        createdAt: parseFilenameToDate(filename),
        recognizedText,
        svgContent,
      };
    })
  );
  
  docs.sort((a, b) => b.filename.localeCompare(a.filename));
  return docs;
}

export async function createDocument(folderUri: string): Promise<{ uri: string; filename: string }> {
  const filename = generateFilename();
  const dir = new Directory(folderUri);
  const file = await dir.createFile(filename);
  return { uri: file.uri, filename };
}

export async function saveDocument(fileUri: string, content: string): Promise<void> {
  const file = new File(fileUri);
  await file.write(content);
}

export async function loadDocument(fileUri: string): Promise<string> {
  const file = new File(fileUri);
  return file.text();
}

export async function deleteDocument(fileUri: string): Promise<void> {
  const file = new File(fileUri);
  await file.delete();
}
```

**Note:** Need to verify new API handles SAF URIs properly. May still need some encoding for specific cases.

#### 2.3 Migration Strategy
1. Create `storage-v2.ts` alongside existing `storage.ts`
2. Update machine to use v2 functions
3. Test all file operations thoroughly
4. Remove `storage.ts` once confirmed working

### Phase 3: Error Handling & Cleanup

#### 3.1 Eliminate Silent Failures
**Locations to update:**
- `storage.ts` (or v2) — log all file operation errors
- `trash.ts` — log purge failures
- `document-list.tsx` — show error UI on load failure

**Pattern:**
```typescript
try {
  const content = await file.text();
} catch (err) {
  console.error('Failed to read file:', file.uri, err);
  // Re-throw or return error state
  throw new StorageError('read_failed', file.uri, err);
}
```

#### 3.2 Add Error Boundary
**File:** `src/components/error-boundary.tsx`

**Usage:** Wrap main stack in `_layout.tsx`

#### 3.3 Remove Debug Code
**File:** `src/features/recognition/atoms.ts`

Remove:
- `_debugInspector` function
- Commented `inspect: debugInspector` line

Keep `safeStringify` if useful for error logging.

---

## Deferred to Later

### SVG Parser Rewrite
**Current:** Regex-based parser in `svg-parser.ts`

**Future:** Use `svg-parser` library with AST traversal

**Why deferred:** Current parser works for our controlled SVG format. Will address when it breaks or when we need to parse external SVGs.

### Loading State Race Condition
**Current:** Separate `loading` and `waitingForCanvas` states with complex transitions

**Future:** Single `setup` actor that coordinates SVG load + canvas ready + restore

**Why deferred:** Current logic works. Will redesign when rethinking loading states holistically.

### Comprehensive Testing
**Current:** 3 test files

**Future:** 
- Machine tests in isolation
- Integration tests for save/load/recognition
- Property-based tests for SVG round-trip

**Why deferred:** Focus on architecture stability first, then add comprehensive tests.

### Canvas Component Further Split
**Current:** 199 lines (after simplification)

**Future:** Could split into smaller components if needed

**Why deferred:** Single machine approach should significantly simplify component. Reassess after migration.

---

## Files Changed

### New Files
- `src/features/storage/utilities/storage-v2.ts` — new storage module using expo-file-system/next
- `src/components/error-boundary.tsx` — error boundary component

### Modified Files
- `src/features/recognition/machine.ts` — merge noteMachine states
- `src/features/recognition/atoms.ts` — remove debug code
- `src/features/canvas/components/canvas.tsx` — simplify to pure UI
- `src/app/_layout.tsx` — add error boundary

### Deprecated Files (remove after migration confirmed)
- `src/features/recognition/note-machine.ts`
- `src/features/storage/utilities/storage.ts`

---

## Success Criteria

1. ✅ Single machine — no parent-child proxying
2. ✅ No manual SAF encoding — using expo-file-system/next
3. ✅ Canvas component < 100 lines, purely presentational
4. ✅ No silent catches — all errors logged
5. ✅ Error boundary in place
6. ✅ Debug code removed

---

## Migration Order

1. **Machine consolidation** — merge machines, test thoroughly
2. **expo-file-system/next migration** — create v2 storage module
3. **Error handling** — add boundaries, remove silent catches
4. **Cleanup** — remove deprecated files, final testing

---

## Notes

- **Refs in context is a DOCUMENTED VIOLATION** — add detailed comment explaining why
- **BackHandler in useEffect is a VIOLATION** — document with rationale
- Keep all other orchestration in machines
- No new features during this refactor
