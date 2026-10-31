# MarkFlow · Product design

**One source. Multiple deliverables.**

[中文](PRD.md) · **English** · [Project home](../README.en.md) · [Development checklist](../OopsMD-TODO.md)

![MarkFlow: shared content for reports and presentations](assets/markflow-hero-en.svg)

MarkFlow is a local workspace for creating, opening, editing, and maintaining different kinds of office content. Marks connect content identity, references, and reusable material across Markdown, formulas, documents, spreadsheets, presentations, and existing PDFs. A document language and independently callable compiler support shared content and multiple deliverables alongside these editing workflows.

The illustration above shows the currently implemented report and slide generation path. It does not replace the broader workspace and module requirements below.

This PRD defines the problem, core experience, and product direction. The local writing workspace, DOCX / PPTX compiler, desktop generation panel, and SDK / CLI are available. The development build also integrates a LaTeX source/PDF workspace, with the limitations below. The checklist tracks implementation; the [validation history](VALIDATION.md) records execution evidence.

Updated: 2026-10-31 · Product stage: development release

The Windows paper runtime is now frozen as an optional offline bundle, with verified installation, progress, cancellation/retry and rollback. The paper workspace accepts the current Markdown snapshot or a local Mark document, generates read-only LaTeX with provenance, and offers an explicit independent TeX copy for direct editing. Shared fact and image changes have been checked in native DOCX, PPTX and PDF outputs. Actual macOS, clean operating-system, physical network-disconnection and OS-level isolation acceptance remain open; implementation scripts are not platform test results. See [delivery evidence and limits](PAPER-DELIVERY.md).

The current optimization pass preserves Note's shared content/template/pagination design, existing DOCX generation, and Stage's native PPTX generation and presentation model. The paper workspace continues to reuse the Mark foundation. Targets are a 50% reduction in owned production source and at least 50% faster key workflows, measured using source bytes/nonblank lines and comparable timings. Dependencies, generated files, examples, and tests are excluded from production-source totals. Removing functionality or validation, relocating code, or minifying source does not satisfy the target. Report individual processing stages, complete exports, and desktop input latency separately; unmet targets remain open.

## 1. Create, edit, and maintain work in one local workspace

Users organize material in their own local folders, create drafts before choosing a save location, and return to existing files to continue working. Everyday editing remains available without an account or network connection. Git version history and remote synchronization are enabled explicitly when needed.

The original usage scenarios remain product requirements. Modules identify the appropriate editor; they do not turn all work into a file-generation task.

| Usage scenario | Intended workflow | Current implementation |
| --- | --- | --- |
| Write Markdown and organize project material | Write or open a document, edit formatted content or source, navigate its outline, and save | Available in the desktop workspace |
| Work on formulas | Create a math draft, enter LaTeX snippets, inspect live rendering beside the source, and save | Formula editor available |
| Write and maintain a paper | Open a complete TeX project, edit source and common document objects, inspect the compiled PDF, and deliver PDF plus reproducible sources | Source/PDF workflow integrated in the development build; L0–L4 acceptance continues, and Formula remains a math-snippet editor |
| Create and edit documents | Create or open supported Note content, configure a template, edit while checking pages, then save or deliver a DOCX | DOCX generation exists; the Note editor, template configuration page, and paginated preview are not implemented |
| Create and edit workbooks | Manage sheets and cells, enter formulas, recalculate, bind charts, and save a supported workbook | Array editor, calculation, charts, and XLSX adapter are not implemented |
| Create and edit presentations | Manage slides, edit page content and layouts, present, and save a supported deck | PPTX generation exists; the Stage editor and presentation view are not implemented |
| Read and modify existing PDFs | Open a file, read it, perform supported page or content operations, and save or save a copy | General PDF workspace not implemented; the paper module has a dedicated compiled-output preview, while attachments can open in a system application |
| Continue across files and sessions | Switch tabs and projects while retaining each file's edit state, drafts, and undo history | Available for the implemented document types |

Shared facts, conclusions, and images can also feed several deliverables. **Maintain shared content once, and give each deliverable its own presentation.** This is an additional workflow; a generated DOCX or PPTX does not establish that its corresponding editor is complete.

| Audience | The work to be done | What MarkFlow offers |
| --- | --- | --- |
| People working with several kinds of office content | Create, read, revise, and deliver material without losing context | A shared workspace with an editor suited to each content type |
| Small teams maintaining project material | Keep reusable facts and assets consistent across files | Explicit content references, templates, versions, and controlled regeneration |
| Developers building document tools | Reuse content operations and supported format output | Independently callable Mark and compiler capabilities through an SDK or CLI |

Creation, opening, reading, editing, saving, and generation have separate capability and acceptance boundaries. The current user-directed delivery focuses on the LaTeX paper workspace. Note template configuration and paginated editing remain a separate requirement; the existing compiler remains the Office output foundation.

## 2. One delivery path: shared content to reports and slides

![The current shared-source report and slide generation path](assets/markflow-workflow-en.svg)

This diagram describes the current compiler workflow. The editing scenarios in section 1 continue independently and are not replaced by this path.

### Write the material

Start with Markdown, or use structured MarkFlow JSON for content you want to reuse. Headings, paragraphs, lists, tables, and images form an explicit source document.

**A Mark is a content unit with an identity, references, and editable meaning.** It gives later changes a stable target, so moving, copying, and updating content have traceable relationships.

### Choose the presentation

A report can develop the background, process, and conclusions. A deck can select highlights, reorder material, and use visual layouts. Both reference the same source while keeping separate presentation descriptions.

Default presentation rules help users get a first result. Explicit sections, slides, layouts, and resources provide more control when needed.

### Generate and deliver

Choose a Word report or PowerPoint deck and generate DOCX / PPTX files. Text, tables, and images remain native objects that recipients can continue editing.

When the material changes, update the shared source and regenerate. The source supports ongoing maintenance; output files support delivery. Bringing edits made in Office back into the source will be introduced with the corresponding import capabilities.

### An example you can try

The existing example turns one fictional project into a **2-page report and a 4-slide deck**. Change “12 cities” to “18 cities” and the corresponding facts update in both outputs. Deliberately oversized content produces a slide-capacity diagnostic linked to the relevant Mark.

[Source material](../examples/compiler/content.json) · [Report](../examples/compiler/generated/report.docx) · [Presentation](../examples/compiler/generated/deck.pptx) · [Complete example](../examples/compiler/README.md)

## 3. Shared content, purpose-built workspaces

The product name is **MarkFlow**. Its modules share a content foundation and workspace while providing editing experiences suited to their material.

| Module | Experience and responsibility | Current progress |
| --- | --- | --- |
| Markdown | Formatted writing, source editing, split view, and navigation | Desktop editor available; usable as generation input |
| Formula | LaTeX math snippets with live rendering | Separate editor available |
| Paper workspace | Complete TeX projects, supported writing controls, local compilation, and synchronized PDF inspection; later, papers generated from Marks | Core workflow integrated; local Windows compilation recorded, distribution and cross-platform acceptance incomplete |
| Note | Document creation, continuous text, sections, page layout, and supported format reading/writing | DOCX generation available; visual editor, template configuration, paginated preview, and import not implemented |
| Stage | Presentation creation, slide management, page editing, and presentation view | PPTX generation available; visual editor, presentation view, and import not implemented |
| Array | Workbooks, cells, calculation, charts, and supported XLSX reading/writing | Editor, calculation, charts, and format adapter not implemented |
| PDF | Open existing files, read, manage pages, edit supported content, and save | General reader/editor not implemented; paper-output preview and system attachment opening are separate capabilities |

**One workspace can host different kinds of editors.** Note organizes flowing text, Stage organizes fixed pages, and Array manages workbooks. The shared core provides identity, references, transactions, and resources; each module retains its domain model.

<details>
<summary>Module naming and language conventions</summary>

| Content | English creation label / type name | Chinese creation label | Chinese type name |
| --- | --- | --- | --- |
| Document | Note | 创建文档 | 文档 |
| Spreadsheet | Array | 创建表格 | 表格 |
| Presentation | Stage | 创建演示 | 演示 |
| Math snippet | Formula | 创建公式 | 公式 |
| Markdown | Markdown | 创建 Markdown | Markdown |

English creation entries use the module name directly. Chinese entries use the functional labels above. Tooltips, feedback, and accessible names follow the interface language. Changing language preserves content, filenames, extensions, document types, and undo history.

The desktop currently uses Chinese for most interface text; complete language switching is future work. Markdown keeps its own entry and remains the startup and generic-new default. Its relationship to the Note entry will be decided as that editor arrives. Creation entries become available with actual editing capabilities; Office generation has its own entry.

PDF uses “打开 PDF / Open PDF”; a separate product name is still open. Its workflow starts with an existing file. Both UI and internal commands reject source-free blank PDF creation, and canceled or failed opens leave no blank draft. Existing PDFs may be edited, saved in place, or saved as copies. Exporting valid content from other modules to PDF is a separate capability.

OopsMD and Geek are historical names. Existing data directories, installer upgrade identifiers, the `latex-math` type, and draft and tab storage keys remain compatible.

</details>

### Note: configure a template and edit against paginated output

This remains a required desktop workflow, not a description of an existing editor. Users can open a dedicated template configuration page before creating a document or alongside an open Note. Forms are the default interface; JSON is the stored configuration and an advanced editing/import/export option. Configuration does not depend on entering the generation dialog or starting an export.

The Note workspace has content editing on the left and a continuously scrollable stack of rendered pages on the right. The right pane shows page boundaries, margins, headers, footers, images, and page-number fields. Its scroll position is independent by default: a user may keep editing near the beginning while inspecting a later page. Navigation to the current Mark is an explicit action, not a permanent scroll lock. Re-rendering preserves the inspected page or content anchor where possible and does not force the preview back to the caret.

| Template configuration | Required behavior |
| --- | --- |
| Page and text styles | Configure paper size, orientation, margins, body and heading typography, spacing, and supported numbering |
| Repeating page regions | Configure header/footer text, images, document fields, and page numbers; define first-page and odd/even variants explicitly |
| Local images and fonts | Select local resources once, retain the template's resource references, and report missing or changed resources before preview/export |
| Reuse and versions | Save a named template and an optional project default; a document records its template ID and version instead of silently following every later template change |
| Layout updates | Re-render from a consistent document, template, asset, and font revision; cancel obsolete work and reject stale results |

Headers and footers reference ordinary content Marks and restricted dynamic fields. Repeated placement does not create new content identities for every page. Style precedence is template defaults, document overrides, then explicit Mark overrides; users can explicitly choose to normalize styles to the template. Editing a template or viewing a preview does not silently rewrite shared text, insert page breaks into source content, or change Mark identities.

Adaptive layout must retain all supported content: reserve space for repeating regions, keep image proportions, respect readable text sizes, continue flowing content across pages, and apply explicit table and keep-together rules. Oversized or unsupported structures receive a localized diagnostic while the last valid preview remains available. Exact fallback and splitting rules are defined in the [Note template and pagination specification](NOTE-PAGINATION.md).

Browser-rendered live pagination and native Word/WPS layout are distinct views. The live view provides responsive editing feedback; a separate native-output proofing view checks a generated artifact in a declared rendering environment. Fonts and office applications can change line breaks, page counts, and field evaluation. The product does not promise pixel-identical pagination between the live view, Word, and WPS, and it must not label a browser approximation as an exact Word rendering.

### Paper workspace: current delivery and remaining requirements

The development build brings complete papers into a separate local workspace. Formula keeps its focused role for math snippets. The paper workflow is the current implementation priority; the Note requirements remain intact.

| Capability | Implementation and evidence boundary |
| --- | --- |
| Projects and templates | Dedicated entry; open folders, import ZIP sources, resume the previous project, or create Chinese, English single-column, and two-column projects; choose the main file and engine |
| Editing and builds | Multi-file source editing, device drafts, conflict-aware saving, a consistent snapshot of unsaved open buffers, background latexmk, cancellation/timeouts, stale-result rejection, and retention of the last successful PDF |
| Preview and navigation | PDF.js continuous pages with independent scrolling, zoom/page controls, on-demand painting, log navigation, and explicit bidirectional SyncTeX; this does not implement editing existing PDF objects |
| Common actions and delivery | Heading/equation/table snippets, image selection, bibliography-key search and citation insertion; PDF and source-ZIP export with input digest, main-file, engine, and environment records; visual table editing and full bibliography management remain incomplete |
| Runtime | Windows TeX Live runtime frozen into a 357,080,995-byte offline bundle with 364 packages, per-file/package/license evidence and a trusted catalog. In-app installation, progress, cancellation/retry and rollback are implemented. macOS, clean-OS/physical-offline acceptance and arbitrary missing-package repair remain open |
| Evidence and limitations | Native results cover Chinese, English single-column/two-column templates, their exported-source rebuilds, and a nested-main-file Biber example. These results do not establish full desktop, clean-distribution, or performance acceptance. External projects require explicit trust before compilation because no operating-system sandbox exists. The restricted Mark-to-LaTeX adapter and provenance-preserving desktop workflow are implemented; detailed evidence is maintained separately |

See the [paper workspace guide](LATEX-WORKSPACE.md) and [implementation checklist](../OopsMD-TODO.md#paper-workspace-todo). The following paragraphs retain the complete product requirements; capabilities beyond this table still require implementation and acceptance.

Users can open an existing paper or start from a verified template. Both use the same workspace; structured Mark authoring arrives in L4:

| Entry path | Authoring and delivery |
| --- | --- |
| Open an existing TeX project | Open a folder or ZIP, detect the main file and ask once when it is ambiguous; retain included sources, `.bib`, `.cls`, `.sty`, `.bst`, figures, and fonts; compile the original project with declared settings |
| Start from a verified template | In L2, choose an English single-column, two-column, or Chinese article template; enter title, authors, and abstract to create a normal TeX project with its environment prepared |
| Create a paper from Marks | In L4, combine structured content with a paper template to generate a TeX project and PDF; retain the Marks and template as the authoritative inputs |

Existing TeX remains authoritative and is not converted into Marks on opening. Controls for supported headings, formulas, figures, tables, citations, and cross-references edit recognized source constructs while preserving unrelated text. The Mark-to-TeX path is one-way generation; editing generated TeX independently requires an explicit handoff to a separate TeX project. Neither path promises lossless conversion of arbitrary LaTeX into Marks.

L2 provides image selection or drop, captions, supported table editing, searchable project bibliography entries, and selectable cross-reference targets. Template changes show a reviewable difference and preserve custom source. Missing citations, duplicate labels, and common compile errors receive localized explanations and source navigation, with the original log available. These controls work without AI. Formula snippets and their existing drafts retain their type; a main file, included chapter, and math snippet are distinguished by project role rather than the `.tex` extension alone.

The primary view pairs an editor with a **new PDF.js preview**, using SyncTeX for explicit navigation between source and PDF. Common object controls reduce repetitive syntax work; source editing remains available for custom macros and unsupported structures. The preview displays compiled output, with independent scrolling and a retained page or content anchor across builds. This is paper authoring and proofing, not native editing of existing PDF objects or unrestricted visual editing of arbitrary TeX layouts. The existing system attachment opener is not a built-in PDF preview.

**A managed, version-pinned TeX Live runtime with latexmk is the target compilation path.** The runtime remains separate and optional, so other workflows do not require TeX. The current Windows development environment uses TinyTeX without R. Freezing and application-managed offline installation are implemented for Windows. Actual macOS and clean-system/physical-offline acceptance remain open; a preparation script alone does not establish platform acceptance. Projects must record their engine, runtime, main file, resources, and settings, and templates must declare their package and font dependencies.

Provisioning now verifies trusted catalog hashes, stages installation, supports progress/cancellation/retry/rollback, and consumes a complete offline pack. No online release endpoint is claimed until an actual release is published. Packages, fonts, the engine, and the BibLaTeX/Biber combination must share a recorded environment version, with explicit updates. Tectonic remains an option for controlled templates, and Typst a possible later Mark output backend. The first delivery concentrates on the TeX Live path for existing journal projects, keeping Note's browser pagination independent.

Reuse the editor shell, project navigation, tabs, drafts, saving, and Git behavior. Add four focused services for paper projects, runtime management, builds, and PDF viewing. Builds run outside the UI and consume a consistent snapshot of all project buffers, including unsaved included files, together with the declared resources and settings. Generated files and build caches stay separate from source files. Each job carries its input revision; canceled or superseded results cannot replace a newer preview. A failed build retains the last successful PDF with its revision and an explicit indication when it is older than the current edits. Error navigation, preview movement, and retries preserve drafts, undo history, and the inspected page.

Opening a project does not execute its scripts. The current compiler disables project latexmk configuration and shell escape and uses controlled tool paths, but these measures are not operating-system isolation. File/network sandboxing and independently verified containment remain L1.6 work; external projects must currently be trusted explicitly before compilation.

The independent [paper implementation backlog](../OopsMD-TODO.md#paper-workspace-todo) proceeds through **L0: baseline and runtime; L1: project compilation; L2: easier writing; L3: acceptance and performance; L4: Mark-to-TeX generation**. L3 follows L2, and L4 depends on L1–L3. The first usable delivery is a PDF and reproducible source package from a complete project, without an AI service.

Performance is a measured goal. On Windows and macOS, record runtime installation cost, cold compilation, warm recompilation, input responsiveness during builds, peak memory, and output quality. Acceptance includes clean machines with no preinstalled TeX and disconnected operation after provisioning. Overleaf comparisons use the same project, engine, TeX Live version, fonts, and relevant compilation settings, with service-plan limits recorded. No speed advantage is claimed before these measurements.

Measure completion rate, time, and help requests for inserting a figure, citing a source, fixing an error, and delivering a paper. Retain failed runs as well as successful ones. Optimize request coalescing, dependency caches, background isolation, stale-result rejection, and visible-page loading against those results; a local edit may still affect global numbering, floats, and pagination. In L4, add the supported paper metadata, abstract, math, labels, references, and source mappings to Mark, then reuse research facts and assets across separately organized papers, reports, and presentations.

Overleaf already offers [hosted compilation and a Visual Editor](https://docs.overleaf.com/getting-started/how-do-i-use-overleaf), [compiler and version selection](https://docs.overleaf.com/getting-started/recompiling-your-project/selecting-a-tex-live-version-and-latex-compiler), and [source/PDF navigation](https://docs.overleaf.com/navigating-in-the-editor/working-with-the-pdf-viewer/moving-between-the-editor-and-pdf). MarkFlow's intended distinction is a simpler local workflow integrated with reusable material. The implementation builds on established tools: [latexmk](https://ctan.org/pkg/latexmk) and, where appropriate, the [TinyTeX distribution](https://yihui.org/tinytex/).

## 4. What you can deliver today

### Generate in the desktop workspace

The **Generate** button beside the file path, the new-tab menu, and the native File menu open the same panel. It offers three sources:

1. **Current Markdown:** the editing snapshot captured when the panel opens, including unsaved text.
2. **Built-in example:** a ready-to-run shared source for a report and a deck.
3. **Local material:** a Markdown or MarkFlow JSON file, with optional presentation, asset folder, and font settings.

Generation runs in the background. The user chooses an output location and can open the completed file or its folder. Diagnostics help locate content issues while preserving the previous valid artifact.

![The current desktop generation panel, shown in Chinese](assets/generate-panel.png)

### Layouts suited to each deliverable

| Output | Initial content and presentation |
| --- | --- |
| DOCX report | Headings, paragraphs, inline styling, links, lists, images, and simple tables; one fixed report theme |
| PPTX deck | Cover, body, image-and-text, and table layouts; native text, basic shapes, images, and tables |
| Source material | Versioned JSON and a supported Markdown subset; PNG / JPEG assets and explicitly selected fonts |

Automatic presentation rules currently use headings, content types, and counts to organize pages. The compiler and editor have separate content coverage; exact fields and support tables live in the [input reference](compiler/LANGUAGE.md).

### Use the engine on its own

The desktop, SDK, and CLI call the same generation pipeline. After dependency installation, compilation uses local material and fonts without a model API key. Existing examples have passed native-object editing and reopening checks in WPS on Windows, and a clean Windows source copy has reproduced CLI generation.

Windows is the first release platform. macOS has desktop development interaction checks; compiler and installer coverage continue separately by platform. [SDK / CLI](compiler/SDK.md) · [Acceptance examples](compiler/ACCEPTANCE.md) · [Reproduction record](compiler/REPRODUCIBILITY.md)

## 5. Keep work moving between sessions

Local files are the foundation of the workspace. Write before choosing a save location, organize files into projects, and move between tabs while drafts and version history support continuity.

- **Editing follows the content.** Markdown's formatted, source, and split views preserve text and undo history. Formula has separate source and split views. Common syntax, local formatting, file navigation, and an outline support everyday writing.
- **Saving protects ongoing changes.** First save chooses a location; canceling retains the draft. Text entered during a save remains a new change, and external file changes go through conflict checks.
- **Version history stays explicit.** Once Git is enabled, manual saves can record local versions. Automatic recording defaults to **500 net changed characters**, with an adjustable threshold and an off switch.
- **Synchronization is deliberate.** Checking a remote, updating the local copy, and uploading are separate actions with separate results. Every project has a local working copy for continued offline writing.
- **The interface gives content room.** Themes, window width, keyboard access, and reduced-motion preferences change the presentation while preserving document and editing state.

<details>
<summary>Workspace, saving, and format contracts</summary>

- Projects offer create, open local, and get from a GitHub link. Creating a project creates a folder; Git is enabled separately. Repository retrieval checks existing copies of the same source before offering reuse or a new copy. Remote binding preserves the current branch, and opening a project remains a local action.
- Remote updates protect all unsaved tabs, staged changes, and untracked material. Missing remote branches require explicit publishing, repositories without common history retain their separate histories, and synchronization uses a non-force-push policy.
- Removing a project removes only its registration. Moved folders can be relocated along with device recovery data. Cloud drives use folders already synchronized by their external clients. When external cloud management is enabled, the client owns remote synchronization and the app pauses Git remote operations. Share-link and WebDAV integration are future scope.
- Each tab retains its own draft, view, and undo state. Closing unsaved content offers save, keep draft, or cancel. Project switching and exit protect unsaved work; recovery conflicts preserve both versions.
- File saves, local commits, and remote synchronization report separately. Git failures retain saved files. Commits contain the current document and explicitly associated assets, preserving other tools' staging state. Device settings and recovery drafts stay on the device.
- The checklist defines the default 500-character counting rules; future binary modules need their own change-recording policy. Read-only Markdown opens and theme or layout changes preserve source files. Explicit saves maintain Mark identity and style metadata through the existing rules.
- Formula remains a math-snippet editor and retains incomplete source. Array separates the workbook model, formula calculation, and charts; filters and slicers are outside its current plan.
- PDF begins with existing-file reading, splitting, merging, rotation, and reordering, then adds annotations and object edits. Reading preserves the source; supported edits can be saved, and Save As preserves the original. OCR and semantic reconstruction produce separately identified results with provenance. Visual covering and removal of original content remain distinct operations.

See the [user guide](USAGE.md) for operations and the [design system](DESIGN-SYSTEM.md) for interaction and themes.

</details>

## 6. How Marks reach different file formats

MarkFlow connects input and output through shared semantics. Markdown is a convenient writing entry, structured JSON is an explicit machine interface, and the internal model retains identity, relationships, and editing information.

| Layer | Responsibility |
| --- | --- |
| Input adapters | Parse Markdown / JSON and map content back to its source |
| Mark core | Content semantics, stable identity, references, revisions, and atomic transactions |
| Presentation descriptions | Select content, organize sections or slides, and choose themes and layouts |
| Compilation and layout | Validate structure and resources, apply defaults, and check dimensions and capacity |
| Format output | Write native target-format objects and generation records |
| Workspace and tool interfaces | Provide desktop editing, generation, SDK, and CLI access |

**Each source has one authoritative representation.** Existing Markdown remains authoritative as text, with semantics supplied by its adapter; structured sources use normalized input. Moves retain identity, copies receive new identity, and transactions and undo follow the existing Mark rules.

For planned paper authoring, an existing TeX project's original source files remain authoritative. Marks and paper templates are authoritative in the separate Mark-to-TeX route; generated TeX and PDF are derived artifacts. Opening or compiling a TeX project does not normalize its source into Marks, and changes to generated TeX are not silently merged back into structured content.

Content, presentation, templates, resources, and diagnostics are managed separately. Output uses explicit document themes and fonts; device reading preferences control on-screen reading. Defaults reduce repeated description, and adapters handle target-format details.

Engineering stays in one repository with clear modules, reusing the Mark engine, mature parsers, and DOCX / PPTX writers. Flowing documents and fixed pages have separate layout logic. New abstractions are grounded in real output paths, keeping code proportional to the work.

As input formats expand, each adapter declares structures it can edit, preserve, degrade, or reject. Imports retain necessary native information and provenance. Generation, extraction, re-layout, and native round-tripping are developed individually. [Architecture](OOPS-ENGINE-ARCHITECTURE.md) · [Compiler implementation](compiler/WRITERS.md)

## 7. AI: focused changes to explicit content

AI remains a planned collaboration entry point. A user selects material, describes a change, reviews the difference, and brings the accepted result into the document. The paper workspace takes priority in the current desktop sequence; this does not remove the Note or AI requirements.

The first integration uses existing Markdown sessions: **select content → prepare context → return Mark operations → preview changes → apply and undo.**

- Start with one explicit API protocol, with configurable service address, model, and device credentials.
- Operations identify the document, Mark, and expected revision. Scope, references, and the current version are checked before applying them.
- Accepted changes form one atomic transaction through the existing drafts, source-writing, undo, and save workflow.
- Show the destination service and material scope before a call. Credentials stay in the device credential facility, and document text is treated as source material.
- Writing, validation, compilation, and export remain available without API configuration.

Knowledge assistance extends the same content chain: detect source changes, build a rebuildable index, retrieve within scope, and link answers to the document, Mark, and source version. Start with keyword retrieval and source navigation; add vector retrieval when measured quality calls for it.

The optimization target is **the total cost of an accepted deliverable**. Templates, bounded operations, and focused context are testable approaches. Evaluation includes prompts, output, retries, time, and manual corrections. [Cost experiment design](compiler/COST-PROTOCOL.md)

## 8. Product roadmap

| Stage | Goal | Current state |
| --- | --- | --- |
| M0 · Shared language | Minimal semantics, support matrix, and runnable examples | Specification and examples available |
| M1 · Compiler foundation | Versioned content, resources, diagnostics, and headless use | Working pipeline available |
| M2-N / M2-S · Editable output | DOCX reports and PPTX decks | Example acceptance completed in Windows WPS |
| M3 · Independent use | SDK / CLI, shared-source examples, and clean-environment reproduction | Interfaces and Windows source-copy reproduction available; release and cross-platform checks continue |
| Desktop integration | Generate from the current document, example, or local material | Integrated and checked in desktop scenarios |
| NP · Note templates and pagination | Dedicated template page, independent paginated live preview, adaptive layout, and a usable Note editing/save/output workflow | Retained requirement; not implemented |
| L0–L4 · Paper workspace | Complete local TeX projects, managed runtime, source/PDF writing, measured acceptance, then Mark-to-TeX generation | Core workflow, Windows offline environment distribution, and restricted Mark-to-TeX generation integrated; OS isolation, macOS and full release acceptance remain incomplete |
| M4 · AI collaboration | Configurable API, change previews, controlled edits, and undo | Retained planned work after the current paper delivery |
| M5 · Cost and quality | Compare full costs under equivalent tasks and quality criteria | Experiment protocol defined |

NP connects the existing output foundation to an actual Note workflow. Note format imports and native round-tripping still require their own support matrices and acceptance. Stage retains its slide editor and presentation workflow; Array retains workbooks, calculation, and charts; PDF retains existing-file reading and supported modification; knowledge assistance retains provenance and retrieval. These product scenarios remain requirements even when their implementation is scheduled later.

Current effort closes the remaining paper-workspace gaps while retaining Note templates, pagination, and the existing single-user writing and compiler capabilities. The [paper workspace backlog](../OopsMD-TODO.md#paper-workspace-todo) tracks the complete acceptance sequence: L0 establishes the baseline and runtime, L1 compiles projects, L2 adds easier writing, L3 measures acceptance and performance after L2, and L4 adds Mark-to-TeX generation after L1–L3. Real-time multi-user collaboration, database products, and a plugin marketplace are evaluated as separate needs. Dependencies, individual tasks, and completion states live in the [development checklist](../OopsMD-TODO.md).

## 9. Judge the product by usable workflows and deliverables

| Desired outcome | Acceptance approach |
| --- | --- |
| Each document type provides its promised workflow | Test creation or opening, reading, editing, saving, and reopening separately; output generation alone does not pass editor acceptance |
| A template can be configured once and reused | Open configuration before or alongside a Note, apply supported page/text/header/footer/image settings, save a versioned template, and reuse it in another document |
| Editing and page inspection remain independent | Edit on the left while browsing later pages on the right; verify independent scrolling, stale-result rejection, and preservation of the preview position |
| Preview preserves the authoritative source | Check that viewing, scrolling, or regenerating the preview does not change text, Mark identity, undo history, or disk content |
| Rendering differences remain visible | Distinguish browser live pagination from native-output proofing and record fonts, application versions, page counts, and supported layout differences |
| A paper project can be edited and delivered | Compile declared multi-file projects with bibliographies, classes, styles, figures, and Chinese/font requirements; verify citations and cross-references; deliver a PDF and reproducible source package without AI |
| Paper builds preserve the current work and useful preview | Compile all unsaved project buffers as one snapshot; reject stale results; isolate caches and external commands; retain the last successful PDF with its revision and independent scroll position after errors |
| Local paper authoring works after provisioning | Validate installation on clean Windows and macOS machines without preinstalled TeX, then compile disconnected with the declared runtime, packages, templates, and fonts; no R runtime is required |
| Paper performance claims have comparable evidence | Measure installation, cold and warm builds, input responsiveness, peak memory, and output quality; match Overleaf project, engine, TeX Live, fonts, and compilation settings, and record platform and service limits |
| Common paper tasks become easier to complete | Compare completion rate, elapsed time, and help requests for adding figures, citations, fixing errors, and exporting; retain failures and use the same quality criteria |
| Mark-to-TeX generation has a clear ownership boundary | In L4, check supported template output and source mappings; retain Mark authority, require explicit handoff for independent TeX editing, and declare unsupported structures without claiming arbitrary round-tripping |
| Shared facts stay consistent | Edit one Mark and check the corresponding report and deck content |
| Recipients can continue working | Edit text, tables, and images in a declared office application version, then save and reopen |
| Problems have actionable causes | Report codes, Mark / source locations, and suggestions for missing resources, invalid references, and overflow |
| Each iteration preserves useful work | Blocking errors retain previous valid output; sources, drafts, and unsaved edits remain protected |
| Results can be examined again | Record compiler, input, theme, font, and asset versions; compare semantic and layout plans |
| Readable layouts retain content | Check long text, multi-page tables, and large images; check fixed-page capacity and inspect DOCX pagination in the target application |
| AI edits can be reviewed and reversed | Check acceptance, stale revisions, out-of-scope operations, failed requests, undo, and disk conflicts |
| New users can run the example | Reproduce from declared source versions and environments, recording platform and application versions separately |

Templates set a minimum readable size. Content that exceeds capacity receives a diagnostic or an explicit page-splitting rule. Reproduction focuses on content, semantics, and layout; final rendering differences between office applications are recorded in the relevant checks.

Cost comparisons cover Mark, Markdown with templates, compact JSON with layout rules, and high-level document APIs, with equivalent template capabilities and quality criteria. Both successful and failed samples count. Metrics include total tokens, first-pass success, repair attempts, time, and manual edits.

Progress is measured through usable editing workflows, reliable generation, continued use, and developer integration. Stars track reach; performance in actual work determines product value.

## 10. Open source and continued development

Public specifications, compiler capabilities, examples, and validation methods let developers understand, reproduce, and extend MarkFlow. The desktop provides a direct experience; SDK / CLI access provides integration. Basic generation works independently of model services.

The repository currently uses the [MIT License](../LICENSE). Future commercial work may include professional templates, team workflows, hosted services, or specialist adapters. Its scope will follow actual needs and module maturity.

A concrete problem is a good place to contribute: a reusable template, an object worth supporting, or a document that reliably reproduces an issue. Each fix can become part of the foundation for later deliverables.

## 11. Documentation map

| Document | Purpose |
| --- | --- |
| [Project home](../README.en.md) | Understand the product and start using it |
| [User guide](USAGE.md) | Find current desktop operations |
| [Development checklist](../OopsMD-TODO.md) | Track dependencies, tasks, and progress |
| [Input language](compiler/LANGUAGE.md) / [SDK](compiler/SDK.md) | Integrate the compiler |
| [Architecture](OOPS-ENGINE-ARCHITECTURE.md) / [Design system](DESIGN-SYSTEM.md) | Extend models and interfaces |
| [Note templates and pagination](NOTE-PAGINATION.md) | Specify the configuration page, independent paginated preview, adaptive layout, and native proofing boundary |
| [Compiler acceptance](compiler/ACCEPTANCE.md) / [Validation history](VALIDATION.md) | Inspect actual environments, artifacts, and coverage |

This PRD defines positioning, naming, and key interactions. Detailed format fields, operating instructions, and implementation progress are maintained in their linked documents, which are currently primarily in Chinese.
