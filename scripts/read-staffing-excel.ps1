param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read)
try {
 function ReadEntry($name) {
  $entry=$zip.GetEntry($name)
  if ($entry) {$reader=[IO.StreamReader]::new($entry.Open());try{$reader.ReadToEnd()}finally{$reader.Dispose()}}
 }
 [xml]$strings=ReadEntry 'xl/sharedStrings.xml'
 $ss=@($strings.sst.si | ForEach-Object {$_.InnerText})
 [xml]$sheet=ReadEntry 'xl/worksheets/sheet1.xml'
 $rows=@($sheet.worksheet.sheetData.row)
 $headers=@{}
 $result=@()
 foreach($row in $rows) {
  $data=@{}
  foreach($cell in $row.c) {
   $col=$cell.r -replace '\d',''
   $value=if($cell.t -eq 's'){$ss[[int]$cell.v]}elseif($cell.t -eq 'inlineStr'){$cell.is.InnerText}else{[string]$cell.v}
   if($row -eq $rows[0]){$headers[$col]=([string]$value).Trim()}
   elseif($headers[$col]){$data[$headers[$col]]=$value}
  }
  if($data['Dni'] -or $data['Ejecutivo']){$result+=$data}
 }
 ConvertTo-Json -InputObject $result -Depth 8 -Compress
} finally {$zip.Dispose();$stream.Dispose()}
