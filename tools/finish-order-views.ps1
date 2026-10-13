# Kalanti iki Tailwind kalibini tema siniflarina cevir (idempotent):
#  - <label class="block text-sm strong mb-1">  -> class="field-label"
#  - animate-spin spinner                      -> class="spinner mx-auto"
$ErrorActionPreference = 'Stop'
$views = 'PurchaseOrdersView', 'TradeOrdersView', 'TradeQuotesView', 'CashBankView'
$root = Join-Path $PSScriptRoot '..\apps\web\src\views'
$root = (Resolve-Path $root).Path

$labelRe = [regex]::New('<label\s+class="block text-sm strong mb-1"', 'Compiled')
$labelRe2 = [regex]::New('<label\s+class="block text-sm font-medium mb-1"', 'Compiled')
$spinRe = [regex]::New('class="animate-spin rounded-full border-4 border-t-2 border-b-2 border-blue-500 h-8 w-8 mx-auto"', 'Compiled')

foreach ($v in $views) {
  $p = Join-Path $root "$v.vue"
  $c = Get-Content $p -Raw
  $n = $labelRe.Replace($c, '<label class="field-label"')
  $n = $labelRe2.Replace($n, '<label class="field-label"')
  $n = $spinRe.Replace($n, 'class="spinner mx-auto"')
  if ($n -ne $c) {
    [System.IO.File]::WriteAllText($p, $n)
    $cnt = ([regex]::Matches($n, 'px-\d|py-\d|bg-white|bg-gray|text-gray-\d|divide-|min-w-full|animate-spin|block text-sm strong')).Count
    Write-Output ("{0,-20} guncellendi. kalan-gorsel-tailwind={1}" -f $v, $cnt)
  } else {
    Write-Output ("{0,-20} degisiklik yok" -f $v)
  }
}
