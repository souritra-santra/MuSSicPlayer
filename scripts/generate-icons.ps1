param(
  [string]$OutDir = "$PSScriptRoot\..\assets\images"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$NOTE = [char]0x266B
$FONT_FAMILY = 'Segoe UI Symbol'

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @($bmp, $g)
}

# Rasterises the note glyph and returns the exact ink bounding box, so we can
# compensate for the difference between the glyph's advance width and its ink
# (fonts are rarely optically centred inside their em square).
function Measure-Note([int]$size, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $fontSize = [float]($size * 0.62 * $scale)
  $font = New-Object System.Drawing.Font($FONT_FAMILY, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Near
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near
  $g.DrawString($NOTE, $font, $brush, (New-Object System.Drawing.PointF(0, 0)), $fmt)

  $minX = $size; $minY = $size; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $size; $y++) {
    for ($x = 0; $x -lt $size; $x++) {
      if ($bmp.GetPixel($x, $y).A -gt 20) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $fmt.Dispose(); $brush.Dispose(); $font.Dispose(); $g.Dispose(); $bmp.Dispose()
  return @{ MinX = $minX; MinY = $minY; MaxX = $maxX; MaxY = $maxY }
}

# Draws the glyph so that its *ink* is centred on the canvas.
function Draw-CenteredNote($g, [int]$size, [System.Drawing.Color]$color, [double]$scale) {
  $ink = Measure-Note $size $scale
  if ($ink.MaxX -lt 0) { throw "glyph '$NOTE' did not render in font '$FONT_FAMILY'" }
  $dx = [float](($size - ($ink.MinX + $ink.MaxX)) / 2)
  $dy = [float](($size - ($ink.MinY + $ink.MaxY)) / 2)

  $fontSize = [float]($size * 0.62 * $scale)
  $font = New-Object System.Drawing.Font($FONT_FAMILY, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush($color)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Near
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near
  $g.DrawString($NOTE, $font, $brush, (New-Object System.Drawing.PointF($dx, $dy)), $fmt)
  $fmt.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Save-Png($bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  "wrote $path ($([math]::Round($bmp.Width))x$($bmp.Height))"
}

# 1. Main app icon: gradient background + white glyph
$c = New-Canvas 1024 1024
$bmp, $g = $c
$rect = New-Object System.Drawing.Rectangle(0, 0, 1024, 1024)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 124, 58, 237),   # #7C3AED
  [System.Drawing.Color]::FromArgb(255, 236, 72, 153),   # #EC4899
  35.0)
$g.FillRectangle($grad, $rect)
$grad.Dispose()
Draw-CenteredNote $g 1024 ([System.Drawing.Color]::White) 0.78
$g.Dispose(); Save-Png $bmp "$OutDir\icon.png"; $bmp.Dispose()

# 2. Splash glyph: transparent, purple, sits on the dark splash background
$c = New-Canvas 512 512
$bmp, $g = $c
Draw-CenteredNote $g 512 ([System.Drawing.Color]::FromArgb(255, 167, 139, 250)) 0.9
$g.Dispose(); Save-Png $bmp "$OutDir\splash-icon.png"; $bmp.Dispose()

# 3. Android adaptive foreground: transparent, glyph kept inside the 66% safe zone
$c = New-Canvas 1024 1024
$bmp, $g = $c
Draw-CenteredNote $g 1024 ([System.Drawing.Color]::White) 0.52
$g.Dispose(); Save-Png $bmp "$OutDir\android-icon-foreground.png"; $bmp.Dispose()

# 4. Android monochrome layer: transparent, solid black glyph (system tints it)
$c = New-Canvas 1024 1024
$bmp, $g = $c
Draw-CenteredNote $g 1024 ([System.Drawing.Color]::Black) 0.52
$g.Dispose(); Save-Png $bmp "$OutDir\android-icon-monochrome.png"; $bmp.Dispose()