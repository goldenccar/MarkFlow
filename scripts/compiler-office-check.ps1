[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$DocxName = 'report.docx',
  [string]$PptxName = 'deck.pptx',
  [ValidateRange(0, 10000)][int]$ExpectedPages = 2,
  [ValidateRange(0, 10000)][int]$ExpectedSlides = 4,
  [string[]]$ExpectedText = @(),
  [string]$ExpectedLastTableText = '',
  [switch]$RequireRepeatedTableHeader,
  [switch]$ReadOnlyCheck
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowed = [IO.Path]::GetFullPath((Join-Path $repo '.test-data/compiler-acceptance'))
$owned = [Collections.Generic.List[object]]::new()
$report = [ordered]@{
  startedAt = [DateTime]::UtcNow.ToString('o')
  mode = $(if ($ReadOnlyCheck) { 'readonly' } else { 'edit-save-reopen' })
  expectedWpsVersion = '12.1.0.29161'
  expectedText = $ExpectedText
  expectedLastTableText = $ExpectedLastTableText
  requireRepeatedTableHeader = [bool]$RequireRepeatedTableHeader
  wpsExecutable = $null
  wpsFileVersion = $null
  docx = $null
  pptx = $null
  result = 'pending'
  error = $null
}

function Assert-TestPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -ne $allowed -and -not $full.StartsWith($allowed + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'All input and output paths must remain inside .test-data/compiler-acceptance.'
  }
  $cursor = $full
  while ($cursor.Length -ge $repo.Length) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse paths are not allowed in this acceptance run: $cursor" }
    }
    if ($cursor -eq $repo) { break }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
  return $full
}
function Input-File([string]$Name, [string]$Extension) {
  if ([IO.Path]::GetFileName($Name) -ne $Name -or [IO.Path]::GetExtension($Name) -ne $Extension) { throw "Expected one $Extension filename inside the input directory." }
  $full = Assert-TestPath (Join-Path $script:inputRoot $Name)
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Generated input does not exist: $full" }
  return $full
}
function New-OutputPath([string]$Name) {
  $full = Assert-TestPath (Join-Path $script:outputRoot $Name)
  if (Test-Path -LiteralPath $full) { throw "Refusing to overwrite an existing acceptance output: $full" }
  return $full
}
function Assert-NotOpen($Collection, [string]$Path) {
  for ($index = 1; $index -le $Collection.Count; $index++) {
    $existing = $Collection.Item($index)
    if ([string]::Equals([string]$existing.FullName, $Path, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'The requested sample is already open. Close that sample before running acceptance; its current buffer was not changed.'
    }
  }
}
function Own($Object, [string]$Kind) {
  $entry = [pscustomobject]@{ Object = $Object; Kind = $Kind; Closed = $false }
  $owned.Add($entry)
  return $entry
}
function Close-Owned($Entry) {
  if ($Entry.Closed) { return }
  if ($Entry.Kind -eq 'docx') { $Entry.Object.Close(0) } else { $Entry.Object.Saved = -1; $Entry.Object.Close() }
  $Entry.Closed = $true
}
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Cell-Text($Range) { return ([string]$Range.Text).TrimEnd([char[]]@([char]13, [char]7)) }
function Word-Metrics($Document) {
  $Document.Repaginate()
  $tableDetails = @()
  $imageDetails = @()
  for ($index = 1; $index -le $Document.InlineShapes.Count; $index++) {
    $picture = $Document.InlineShapes.Item($index)
    $imageDetails += [ordered]@{ index = $index; type = [int]$picture.Type; widthPt = [double]$picture.Width; heightPt = [double]$picture.Height }
  }
  for ($index = 1; $index -le $Document.Tables.Count; $index++) {
    $table = $Document.Tables.Item($index)
    $first = @(); $last = @()
    for ($column = 1; $column -le $table.Columns.Count; $column++) {
      $first += Cell-Text ($table.Cell(1, $column).Range)
      $last += Cell-Text ($table.Cell($table.Rows.Count, $column).Range)
    }
    $tableDetails += [ordered]@{ rows = [int]$table.Rows.Count; columns = [int]$table.Columns.Count; firstRowRepeats = [bool]$table.Rows.Item(1).HeadingFormat; firstRow = $first; lastRow = $last }
  }
  $pageSetup = $Document.PageSetup
  return [ordered]@{ pages = [int]$Document.ComputeStatistics(2); paragraphs = [int]$Document.Paragraphs.Count; tables = [int]$Document.Tables.Count; inlineImages = [int]$Document.InlineShapes.Count; floatingShapes = [int]$Document.Shapes.Count; tableDetails = $tableDetails; imageDetails = $imageDetails; bodyWidthPt = [double]$pageSetup.PageWidth - [double]$pageSetup.LeftMargin - [double]$pageSetup.RightMargin }
}
function Slide-Metrics($Presentation) {
  $text = 0; $tables = 0; $pictures = 0; $shapes = 0
  $imageDetails = @()
  for ($page = 1; $page -le $Presentation.Slides.Count; $page++) {
    $slide = $Presentation.Slides.Item($page)
    for ($index = 1; $index -le $slide.Shapes.Count; $index++) {
      $shape = $slide.Shapes.Item($index); $shapes++
      if ($shape.HasTextFrame -ne 0 -and $shape.TextFrame.HasText -ne 0) { $text++ }
      if ($shape.HasTable -ne 0) { $tables++ }
      if ([int]$shape.Type -in @(11, 13)) {
        $pictures++
        $imageDetails += [ordered]@{ slide = $page; name = [string]$shape.Name; widthPt = [double]$shape.Width; heightPt = [double]$shape.Height; leftPt = [double]$shape.Left; topPt = [double]$shape.Top }
      }
    }
  }
  return [ordered]@{ slides = [int]$Presentation.Slides.Count; shapes = $shapes; textShapes = $text; tables = $tables; pictures = $pictures; imageDetails = $imageDetails; slideWidthPt = [double]$Presentation.PageSetup.SlideWidth; slideHeightPt = [double]$Presentation.PageSetup.SlideHeight }
}
function Export-PresentationPdf($Presentation, [string]$Path) {
  try {
    # PrintRange is required even though it may be null in the Office API.
    $Presentation.ExportAsFixedFormat($Path, 2, 2, 0, 1, 1, 0, $null, 1, '', $true, $true, $true, $true, $false, $null)
    return [ordered]@{ method = 'ExportAsFixedFormat'; fallbackReason = $null }
  } catch {
    $reason = $_.Exception.Message
    if (Test-Path -LiteralPath $Path) { throw "PDF export failed after creating an output; refusing to overwrite it: $reason" }
    # WPS 12's COM binding rejects this method in PowerShell 7; its native PDF copy
    # export keeps the presentation filename and edits untouched.
    $originalName = [string]$Presentation.FullName
    $Presentation.SaveCopyAs($Path, 32, 0)
    Require ([string]$Presentation.FullName -eq $originalName) 'PDF copy export changed the presentation filename.'
    return [ordered]@{ method = 'SaveCopyAs PDF'; fallbackReason = $reason }
  }
}

$inputRoot = Assert-TestPath $InputDirectory
$outputRoot = Assert-TestPath $OutputDirectory
Require (Test-Path -LiteralPath $inputRoot -PathType Container) 'The generated input directory does not exist.'
if (-not (Test-Path -LiteralPath $outputRoot)) { $null = New-Item -ItemType Directory -Path $outputRoot }
Require (Test-Path -LiteralPath $outputRoot -PathType Container) 'The output directory is not a folder.'
$reportPath = New-OutputPath 'office-check.json'
try {
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\wps.exe', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\wps.exe')) {
    if (Test-Path -LiteralPath $key) {
      $exe = (Get-Item -LiteralPath $key).GetValue('')
      if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
        $report.wpsExecutable = $exe
        $report.wpsFileVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
        break
      }
    }
  }
  if ($DocxName) {
    $source = Input-File $DocxName '.docx'
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $stem = [IO.Path]::GetFileNameWithoutExtension($DocxName)
    $originalPdf = New-OutputPath ($stem + '.original.docx.pdf')
    $word = New-Object -ComObject 'kwps.Application'
    $beforeCount = [int]$word.Documents.Count
    Assert-NotOpen $word.Documents $source
    $entry = Own ($word.Documents.Open($source, $false, $true, $false)) 'docx'
    $doc = $entry.Object
    $metrics = Word-Metrics $doc
    $result = [ordered]@{ source = $source; sourceSha256 = $hash; applicationVersion = [string]$word.Version; before = $metrics; edited = $null; reopened = $null; originalPdf = $originalPdf; editedPdf = $null; existingDocuments = $beforeCount; checks = @() }
    $report.docx = $result
    $doc.ExportAsFixedFormat($originalPdf, 17)
    Require (Test-Path -LiteralPath $originalPdf -PathType Leaf) 'Original DOCX PDF export did not create a file.'
    Require ($ExpectedPages -eq 0 -or $metrics.pages -eq $ExpectedPages) "DOCX has $($metrics.pages) pages; expected $ExpectedPages."
    foreach ($expected in $ExpectedText) { Require (([string]$doc.Content.Text).Contains($expected)) "DOCX did not contain expected sample text: $expected" }
    if ($ExpectedLastTableText) { Require ($metrics.tables -gt 0 -and ($metrics.tableDetails[-1].lastRow -join ' ').Contains($ExpectedLastTableText)) 'DOCX last table row did not contain the expected sample text.' }
    if ($RequireRepeatedTableHeader) { Require ($metrics.tables -gt 0 -and $metrics.tableDetails[0].firstRowRepeats) 'DOCX first table header is not marked to repeat across pages.' }
    if (-not $ReadOnlyCheck) {
      Require ($metrics.tables -gt 0 -and $metrics.inlineImages -gt 0) 'DOCX must contain a native table and an inline image for editing acceptance.'
      $edited = New-OutputPath ($stem + '.edited.docx')
      Assert-NotOpen $word.Documents $edited
      $doc.SaveAs($edited, 12)
      $range = $null
      for ($index = 1; $index -le $doc.Paragraphs.Count; $index++) {
        $candidate = $doc.Paragraphs.Item($index).Range.Duplicate
        if (([string]$candidate.Text).Trim().Length -gt 0 -and -not $candidate.Information(12)) { $range = $candidate; break }
      }
      Require ($null -ne $range) 'DOCX contains no editable body paragraph.'
      $range.End = $range.End - 1
      $editedText = [string]$range.Text + ' [DOCX-QA]'
      $range.Text = $editedText
      $table = $doc.Tables.Item(1)
      $row = $(if ($table.Rows.Count -ge 2) { 2 } else { 1 })
      $cell = $table.Cell($row, 1).Range.Duplicate
      $expectedCell = (Cell-Text $cell) + ' [TABLE-QA]'
      # WPS exposes CR+BEL in Range.Text but counts the cell terminator as one position.
      $cell.End = $cell.End - 1; $cell.Text = $expectedCell
      $image = $doc.InlineShapes.Item(1)
      $expectedWidth = [double]$image.Width * 0.9
      $image.Width = $expectedWidth
      $doc.Save()
      Close-Owned $entry
      $entry = Own ($word.Documents.Open($edited, $false, $true, $false)) 'docx'
      $doc = $entry.Object
      Require (([string]$doc.Content.Text).Contains($editedText)) 'Reopened DOCX lost the text edit.'
      Require ((Cell-Text ($doc.Tables.Item(1).Cell($row, 1).Range)) -eq $expectedCell) 'Reopened DOCX lost the native table edit.'
      Require ([Math]::Abs([double]$doc.InlineShapes.Item(1).Width - $expectedWidth) -lt 0.2) 'Reopened DOCX lost the image resize.'
      $result.edited = $edited; $result.reopened = Word-Metrics $doc
      $result.checks = @('text edit persisted', 'table edit persisted', 'inline image resize persisted')
      $editedPdf = New-OutputPath ($stem + '.edited.docx.pdf')
      $doc.ExportAsFixedFormat($editedPdf, 17)
      Require (Test-Path -LiteralPath $editedPdf -PathType Leaf) 'Edited DOCX PDF export did not create a file.'
      $result.editedPdf = $editedPdf
    }
    Close-Owned $entry
    Require ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -eq $hash) 'Original DOCX changed during acceptance.'
    Require ([int]$word.Documents.Count -eq $beforeCount) 'WPS document count changed beyond the objects owned by this run.'
  }
  if ($PptxName) {
    $source = Input-File $PptxName '.pptx'
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $stem = [IO.Path]::GetFileNameWithoutExtension($PptxName)
    $originalPdf = New-OutputPath ($stem + '.original.pptx.pdf')
    $powerpoint = New-Object -ComObject 'kwpp.Application'
    $beforeCount = [int]$powerpoint.Presentations.Count
    Assert-NotOpen $powerpoint.Presentations $source
    $entry = Own ($powerpoint.Presentations.Open($source, -1, 0, 0)) 'pptx'
    $presentation = $entry.Object
    $metrics = Slide-Metrics $presentation
    $result = [ordered]@{ source = $source; sourceSha256 = $hash; applicationVersion = [string]$powerpoint.Version; before = $metrics; edited = $null; reopened = $null; originalPdf = $originalPdf; editedPdf = $null; existingPresentations = $beforeCount; checks = @() }
    $report.pptx = $result
    $result.originalPdfExport = Export-PresentationPdf $presentation $originalPdf
    Require (Test-Path -LiteralPath $originalPdf -PathType Leaf) 'Original PPTX PDF export did not create a file.'
    Require ($ExpectedSlides -eq 0 -or $metrics.slides -eq $ExpectedSlides) "PPTX has $($metrics.slides) slides; expected $ExpectedSlides."
    $slideTexts = @()
    for ($page = 1; $page -le $presentation.Slides.Count; $page++) {
      foreach ($shape in $presentation.Slides.Item($page).Shapes) {
        if ($shape.HasTextFrame -ne 0 -and $shape.TextFrame.HasText -ne 0) { $slideTexts += [string]$shape.TextFrame.TextRange.Text }
      }
    }
    foreach ($expected in $ExpectedText) { Require (($slideTexts -join "`n").Contains($expected)) "PPTX did not contain expected sample text: $expected" }
    if (-not $ReadOnlyCheck) {
      Require ($metrics.textShapes -gt 0 -and $metrics.tables -gt 0 -and $metrics.pictures -gt 0) 'PPTX must contain native text, table and image objects for editing acceptance.'
      $edited = New-OutputPath ($stem + '.edited.pptx')
      Assert-NotOpen $powerpoint.Presentations $edited
      $presentation.SaveAs($edited, 24)
      $textEdit = $null; $tableEdit = $null; $imageEdit = $null
      for ($page = 1; $page -le $presentation.Slides.Count; $page++) {
        $slide = $presentation.Slides.Item($page)
        for ($index = 1; $index -le $slide.Shapes.Count; $index++) {
          $shape = $slide.Shapes.Item($index)
          if (-not $textEdit -and $shape.HasTextFrame -ne 0 -and $shape.TextFrame.HasText -ne 0) {
            $editedText = [string]$shape.TextFrame.TextRange.Text + ' [PPTX-QA]'
            $shape.TextFrame.TextRange.Text = $editedText
            $textEdit = @{ Slide = $page; Name = [string]$shape.Name; Expected = $editedText }
          }
          if (-not $tableEdit -and $shape.HasTable -ne 0) {
            $row = $(if ($shape.Table.Rows.Count -ge 2) { 2 } else { 1 })
            $cell = $shape.Table.Cell($row, 1).Shape.TextFrame.TextRange
            $expectedCell = [string]$cell.Text + ' [TABLE-QA]'
            $cell.Text = $expectedCell
            $tableEdit = @{ Slide = $page; Name = [string]$shape.Name; Row = $row; Expected = $expectedCell }
          }
          if (-not $imageEdit -and [int]$shape.Type -in @(11, 13)) {
            $expectedWidth = [double]$shape.Width * 0.9
            $shape.Width = $expectedWidth
            $imageEdit = @{ Slide = $page; Name = [string]$shape.Name; Expected = $expectedWidth }
          }
        }
      }
      Require ($null -ne $textEdit -and $null -ne $tableEdit -and $null -ne $imageEdit) 'PPTX edit targets were not found.'
      $presentation.Save()
      Close-Owned $entry
      $entry = Own ($powerpoint.Presentations.Open($edited, -1, 0, 0)) 'pptx'
      $presentation = $entry.Object
      Require ([string]$presentation.Slides.Item($textEdit.Slide).Shapes.Item($textEdit.Name).TextFrame.TextRange.Text -eq $textEdit.Expected) 'Reopened PPTX lost the native text edit.'
      Require ([string]$presentation.Slides.Item($tableEdit.Slide).Shapes.Item($tableEdit.Name).Table.Cell($tableEdit.Row, 1).Shape.TextFrame.TextRange.Text -eq $tableEdit.Expected) 'Reopened PPTX lost the native table edit.'
      Require ([Math]::Abs([double]$presentation.Slides.Item($imageEdit.Slide).Shapes.Item($imageEdit.Name).Width - $imageEdit.Expected) -lt 0.2) 'Reopened PPTX lost the image resize.'
      $result.edited = $edited; $result.reopened = Slide-Metrics $presentation
      $result.checks = @('text edit persisted', 'table edit persisted', 'image resize persisted')
      $editedPdf = New-OutputPath ($stem + '.edited.pptx.pdf')
      $result.editedPdfExport = Export-PresentationPdf $presentation $editedPdf
      Require (Test-Path -LiteralPath $editedPdf -PathType Leaf) 'Edited PPTX PDF export did not create a file.'
      $result.editedPdf = $editedPdf
    }
    Close-Owned $entry
    Require ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -eq $hash) 'Original PPTX changed during acceptance.'
    Require ([int]$powerpoint.Presentations.Count -eq $beforeCount) 'WPS presentation count changed beyond the objects owned by this run.'
  }
  Require ([bool]$DocxName -or [bool]$PptxName) 'Select at least one generated document.'
  $report.result = 'passed'
} catch {
  $report.result = 'failed'; $report.error = $_.Exception.Message; $report.errorLocation = $_.ScriptStackTrace
  Write-Warning $report.error
} finally {
  foreach ($entry in $owned) {
    if (-not $entry.Closed) {
      try { Close-Owned $entry } catch { $report.result = 'failed'; $report.error = [string]$report.error + ' Owned-document close failed: ' + $_.Exception.Message }
    }
  }
  $report.finishedAt = [DateTime]::UtcNow.ToString('o')
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}
Write-Output ($report | ConvertTo-Json -Depth 8 -Compress)
if ($report.result -ne 'passed') { exit 1 }
