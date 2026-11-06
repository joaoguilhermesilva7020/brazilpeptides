# Live smoke test for the published confirm-payment Edge Function.
# Safe by design: uses a deliberately nonexistent order UUID and does not mutate data.

$ErrorActionPreference = "Stop"

$projectUrl = "https://xuutmhgjrrsmtropldwh.supabase.co"
$functionUrl = "$projectUrl/functions/v1/confirm-payment"
$authUrl = "$projectUrl/auth/v1/token?grant_type=password"
$nonexistentOrderId = "00000000-0000-0000-0000-000000000000"

function Convert-SecureStringToPlainText([System.Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-AccessToken([string]$Email, [string]$Label, [string]$AnonKey) {
    $securePassword = Read-Host "$Label - senha do Supabase Auth" -AsSecureString
    $password = Convert-SecureStringToPlainText $securePassword

    try {
        $payload = @{
            email = $Email
            password = $password
        } | ConvertTo-Json

        $login = Invoke-RestMethod -Method Post -Uri $authUrl -Headers @{
            apikey = $AnonKey
        } -ContentType "application/json" -Body $payload

        if ([string]::IsNullOrWhiteSpace($login.access_token)) {
            throw "O login não retornou access_token."
        }

        return [string]$login.access_token
    }
    catch {
        throw "Não foi possível autenticar $Label. Confira o e-mail e a senha no Supabase Auth."
    }
    finally {
        $password = $null
        $payload = $null
        $securePassword.Dispose()
    }
}


function Invoke-FunctionRequest(
    [string]$Name,
    [string]$ExpectedFragment,
    [int]$ExpectedStatus,
    [string]$Token,
    [string]$AnonKey
) {
    $headers = @{ apikey = $AnonKey }

    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        $headers.Authorization = "Bearer $Token"
    }

    $body = @{
        order_id = $nonexistentOrderId
    } | ConvertTo-Json

    $status = 0
    $responseText = ""

    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Post `
            -Uri $functionUrl `
            -Headers $headers `
            -ContentType "application/json" `
            -Body $body `
            -ErrorAction Stop

        $status = [int]$response.StatusCode
        $responseText = [string]$response.Content
    }
    catch {
        $httpResponse = $_.Exception.Response

        if ($null -eq $httpResponse) {
            throw "Falha de rede no teste '$Name': $($_.Exception.Message)"
        }

        $status = [int]$httpResponse.StatusCode
        $responseStream = $httpResponse.GetResponseStream()

        if ($null -ne $responseStream) {
            $reader = New-Object System.IO.StreamReader($responseStream)

            try {
                $responseText = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
                $responseStream.Dispose()
            }
        }
    }

    $passed = ($status -eq $ExpectedStatus)

    if ($passed -and -not [string]::IsNullOrWhiteSpace($ExpectedFragment)) {
        $normalizedResponse = [regex]::Replace(
            [string]$responseText,
            '[^\p{L}\p{N}]',
            ''
        )

        $normalizedExpected = [regex]::Replace(
            [string]$ExpectedFragment,
            '[^\p{L}\p{N}]',
            ''
        )

        $passed = $normalizedResponse.IndexOf(
            $normalizedExpected,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0
    }

    if ($passed) {
        Write-Host "[PASS] $Name (HTTP $status)" -ForegroundColor Green
        return
    }

    Write-Host "[FAIL] $Name (esperado HTTP $ExpectedStatus; recebido HTTP $status)" -ForegroundColor Red

    if (-not [string]::IsNullOrWhiteSpace($responseText)) {
        Write-Host "Resposta: $responseText"
    }
    else {
        Write-Host "Resposta HTTP sem corpo legível."
    }

    throw "O teste '$Name' falhou."
}

Write-Host "Teste de integração da Edge Function confirm-payment"
Write-Host "Projeto: $projectUrl"
Write-Host "O script usará somente um UUID inexistente; nenhum pedido ou estoque será alterado."
Write-Host ""

$anonKey = Read-Host "Informe a chave anon/publicável do projeto (NÃO use service_role/secret)"
if ([string]::IsNullOrWhiteSpace($anonKey)) {
    throw "A chave anon/publicável é obrigatória."
}

$adminEmail = Read-Host "E-mail do usuário administrador cadastrado em public.admin_users"
if ([string]::IsNullOrWhiteSpace($adminEmail)) {
    throw "O e-mail do administrador é obrigatório."
}
$adminToken = Get-AccessToken -Email $adminEmail -Label "Administrador" -AnonKey $anonKey

# Requests without a valid JWT are rejected by the Supabase gateway (verify_jwt=true).
Invoke-FunctionRequest -Name "Sem token" -ExpectedStatus 401 -Token "" -AnonKey $anonKey
Invoke-FunctionRequest -Name "Token inválido" -ExpectedStatus 401 -Token "invalid.test.token" -AnonKey $anonKey

# A real admin JWT must pass auth/admin checks and reach the RPC.
# The deliberately nonexistent UUID makes the RPC return 400 before any write.
Invoke-FunctionRequest -Name "JWT de administrador chega à RPC" -ExpectedStatus 400 -ExpectedFragment "Pedido não encontrado." -Token $adminToken -AnonKey $anonKey

$nonAdminEmail = Read-Host "E-mail de um usuário Auth que NÃO esteja em public.admin_users (Enter para pular)"
if (-not [string]::IsNullOrWhiteSpace($nonAdminEmail)) {
    $nonAdminToken = Get-AccessToken -Email $nonAdminEmail -Label "Usuário não administrador" -AnonKey $anonKey
    Invoke-FunctionRequest -Name "Usuário autenticado sem perfil admin é bloqueado" -ExpectedStatus 403 -ExpectedFragment "Acesso restrito ao administrador" -Token $nonAdminToken -AnonKey $anonKey
    $nonAdminToken = $null
}
else {
    Write-Host "[SKIP] Teste de usuário não administrador (nenhum e-mail informado)." -ForegroundColor Yellow
}

$adminToken = $null
Write-Host ""
Write-Host "Smoke tests concluídos. Nenhum pedido, pagamento ou saldo de estoque foi alterado." -ForegroundColor Green
