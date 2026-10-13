# Tailwind -> tema (Fintech) deterministik donusum.
# Kullanim: pwsh -File tools\convert-order-views.ps1
$ErrorActionPreference = 'Stop'
$views = 'PurchaseOrdersView', 'TradeOrdersView', 'TradeQuotesView'
$root = Join-Path $PSScriptRoot '..\apps\web\src\views'
$root = (Resolve-Path $root).Path

# Sira ONEMLI: ozel/uzun -> genel/kisa. .Replace() literal + case-sensitive.
$map = [ordered]@{
  # --- root ---
  'class="purchase-orders-view"' = 'class="page"'
  'class="trade-orders-view"'    = 'class="page"'
  'class="trade-quotes-view"'    = 'class="page"'
  # --- statusBadgeClass fonksiyonu: Tailwind renk -> tema .badge-* (generic 'font-medium' kuralindan ONCE) ---
  '`px-2 py-1 text-xs font-medium rounded ${classes[status]' = '`badge ${classes[status]'
  "'bg-gray-100 text-gray-800'"   = "'badge-neutral'"
  "'bg-blue-100 text-blue-800'"   = "'badge-info'"
  "'bg-green-100 text-green-800'" = "'badge-success'"
  "'bg-yellow-100 text-yellow-800'" = "'badge-warning'"
  "'bg-purple-100 text-purple-800'" = "'badge-info'"
  "'bg-red-100 text-red-800'"     = "'badge-danger'"
  "'bg-red-200 text-red-900'"     = "'badge-danger'"
  # --- tablo hucreleri (ozel -> genel) ---
  'px-6 py-4 whitespace-nowrap text-sm font-medium text-right text-gray-900' = 'num strong'
  'px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900'              = 'mono'
  'px-6 py-4 whitespace-nowrap text-sm font-medium'                          = 'strong'
  'px-6 py-4 whitespace-nowrap text-sm text-gray-900'                        = 'strong'
  'px-6 py-4 whitespace-nowrap text-sm text-gray-500'                        = 'muted'
  'px-6 py-4 whitespace-nowrap text-sm'                                      = ''
  'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'  = ''
  'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider' = 'num'
  'px-4 py-2 text-right text-xs font-medium text-gray-500' = 'num'
  'px-4 py-2 text-left text-xs font-medium text-gray-500'  = ''
  'px-4 py-2 text-right text-sm font-medium'               = 'num strong'
  'px-4 py-2 text-right text-sm'                           = 'num'
  'px-4 py-2 text-sm'                                      = ''
  'px-6 py-4 text-center text-gray-500'                    = 'empty-cell muted'
  'px-6 py-4 text-center'                                  = 'empty-cell'
  # --- grid duzeni ---
  'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4' = 'form-grid'
  'grid grid-cols-1 md:grid-cols-3 gap-4'                 = 'form-grid'
  'grid grid-cols-1 md:grid-cols-6 gap-2 mb-2 items-end'  = 'line-row'
  'grid grid-cols-2 gap-4 mb-4 text-sm'                   = 'detail-grid'
  'md:col-span-2'                                          = 'line-desc'
  'col-span-2'                                             = 'form-field-full'
  # --- baslik/satir duzeni ---
  'flex justify-between items-center mb-6'         = 'page-header'
  'flex justify-between items-center mb-4'         = 'modal-head'
  'flex justify-end space-x-3 pt-4 border-t'       = 'modal-actions'
  'text-2xl font-bold'                             = 'page-title'
  'text-xl font-bold mb-4'                         = 'card-title'
  'text-xl font-bold'                              = 'card-title'
  'text-lg font-medium mt-4 mb-2'                  = 'form-section-title'
  'text-lg font-medium mb-2'                       = 'form-section-title'
  'font-medium font-large'                         = 'detail-total'
  'font-medium'                                    = 'strong'
  # --- kart/tablo kabi ---
  'bg-white rounded-lg shadow p-4 mb-6'         = 'toolbar'
  'bg-white rounded-lg shadow overflow-hidden'  = 'table-wrap'
  'overflow-x-auto mb-4'                        = 'table-wrap'
  'overflow-x-auto'                             = 'table-wrap'
  'min-w-full divide-y divide-gray-200'         = 'data-table'
  'bg-gray-50'                                  = ''
  'bg-white divide-y divide-gray-200'           = ''
  'divide-y divide-gray-200'                    = ''
  'hover:bg-gray-50'                            = ''
  # --- form alanlari ---
  'w-full px-3 py-2 border rounded'             = 'input'
  'block text-sm font-medium mb-1'              = 'field-label'
  # --- butonlar ---
  'btn btn-primary w-full'                      = 'btn btn-primary'
  'btn btn-secondary text-red-600 border-red-300' = 'btn btn-danger'
  # --- eylem linkleri ---
  'text-blue-600 hover:text-blue-900 mr-3'   = 'link'
  'text-green-600 hover:text-green-900 mr-3' = 'link'
  'text-red-600 hover:text-red-900'          = 'link danger'
  'text-gray-500 hover:text-gray-700'        = 'link'
  # --- pagination ---
  'px-6 py-4 border-t flex items-center justify-between' = 'pager'
  'text-sm text-gray-500'                                = 'muted'
  # --- modal ---
  'modal-content max-w-3xl max-h-[90vh] overflow-y-auto' = 'modal-content modal-lg'
  'modal-content max-w-4xl max-h-[90vh] overflow-y-auto' = 'modal-content modal-lg'
  # --- son: saf text-gray (kalmissa) ---
  'text-gray-500' = 'muted'
}

foreach ($v in $views) {
  $path = Join-Path $root "$v.vue"
  $src = Get-Content $path -Raw
  # 1) textarea'yi once ayir (input'dan once)
  $src = [regex]::Replace($src, '(<textarea\b[^>]*?\bclass=")w-full px-3 py-2 border rounded(")', '${1}textarea${2}')
  # 2) literal donusumler
  foreach ($k in $map.Keys) { $src = $src.Replace($k, $map[$k]) }
  # 3) temizlik: bos/cift bosluklu class degerleri
  $src = [regex]::Replace($src, 'class="\s*"', '')
  $src = [regex]::Replace($src, 'class="  +"', '')
  $src = $src.Replace('class=" ', 'class="').Replace(' ">', '">')
  # 3b) kalan tek basina divide-y / divide-gray kalintilari
  $src = $src.Replace('class="divide-y divide-gray-200"', 'class="data-table"')
  # 4) scoped <style> blogunu kaldir (global tema .btn/.modal-* zaten tanimli)
  $src = [regex]::Replace($src, '(?s)\r?\n<style scoped>.*?</style>\s*$', "`n")
  Copy-Item $path "$path.bak" -Force
  Set-Content -Path $path -Value $src -NoNewline -Encoding utf8
  $left = ([regex]::Matches($src, 'px-\d|py-\d|bg-white|bg-gray|text-gray-\d|divide-|min-w-full')).Count
  Write-Output ("{0,-20} converted. remaining-visual-tailwind={1}" -f $v, $left)
}