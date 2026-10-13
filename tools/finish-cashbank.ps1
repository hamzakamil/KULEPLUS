$path = 'c:\proje\Muhasebe\apps\web\src\views\CashBankView.vue'
$lines = Get-Content $path
$out = New-Object System.Collections.Generic.List[string]
$lastTag = ''
$log = 0

foreach ($line in $lines) {
  $l = $line

  # En yakın element tag'ini hatırla (tek satır açılışta)
  if ($l -match '<(select|input|textarea|table|thead|tbody|th|td|tr|form|button|span|div|h2)\b(?![^>]*/>)') {
    $lastTag = $matches[1]
  }

  # 1) Select/input/textarea kutuları: "px-3 py-2 border rounded" → tema sınıfı
  if ($l -match 'class="(?:w-full )?px-3 py-2 border rounded"') {
    $map = @{ select = 'select'; input = 'input'; textarea = 'textarea' }
    $cls = if ($map.ContainsKey($lastTag)) { $map[$lastTag] } else { 'input' }
    $l = $l -replace 'class="(?:w-full )?px-3 py-2 border rounded"', ('class="' + $cls + '"')
    $log++
  }

  # 2) Tablo: overflow kabı + tablo + thead/tbody/hover + th/td sınıfları
  $l = $l -replace 'class="overflow-x-auto"', 'class="table-wrap"'
  $l = $l -replace 'class="min-w-full divide-y divide-gray-200"', 'class="data-table"'
  $l = $l -replace 'class="bg-gray-50"', ''
  $l = $l -replace 'class="bg-white divide-y divide-gray-200"', ''
  $l = $l -replace 'class="hover:bg-gray-50"', ''
  $l = $l -replace 'class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"', ''
  $l = $l -replace 'class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase"', ''
  $l = $l -replace 'class="px-6 py-4 whitespace-nowrap text-sm text-gray-900"', ''
  $l = $l -replace 'class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900"', 'class="strong"'
  $l = $l -replace 'class="px-6 py-4 whitespace-nowrap text-sm font-medium"', 'class="actions"'
  $l = $l -replace 'class="px-6 py-4 whitespace-nowrap text-sm"', ''
  $l = $l -replace 'class="px-6 py-4 text-sm text-gray-900"', 'class="wrap"'
  $l = $l -replace 'class="px-6 py-4 text-center text-gray-500"', 'class="empty-cell"'
  $l = $l -replace 'class="px-6 py-4 text-center"', 'class="empty-cell"'

  # 3) Pagination: pager + span temizliği + opacity-50 kaldır (btn:disabled zaten)
  $l = $l -replace 'class="mt-4 flex justify-between items-center"', 'class="pager"'
  $l = $l -replace 'class="text-sm text-gray-600"', ''
  $l = $l -replace '\s*:class="\{ ''opacity-50'': [^}]+\}"', ''

  # 4) Modal: grid-cols-2 → form-grid; footer → modal-actions; h2 temiz
  $l = $l -replace 'class="grid grid-cols-2 gap-4"', 'class="form-grid"'
  $l = $l -replace 'class="flex justify-end space-x-3"', 'class="modal-actions"'
  $l = $l -replace 'class="text-xl font-bold mb-4"', ''

  # 5) Satır içi linkler: düzenle/sil → tema link
  $l = $l -replace 'class="text-blue-600 hover:text-blue-900 mr-3"', 'class="link"'
  $l = $l -replace 'class="text-red-600 hover:text-red-900"', 'class="link danger"'

  # 6) Spinner td: mx-auto gerekmez (empty-cell center)
  $l = $l -replace 'class="spinner mx-auto"', 'class="spinner"'

  $out.Add($l)
}

# Boş kalan class attribute'larını tamamen temizle: class=""
$out = $out | ForEach-Object { $_ -replace '\s*class=""', '' }

Set-Content -Path $path -Value $out -Encoding UTF8
Write-Output ("Done. log=" + $log)
