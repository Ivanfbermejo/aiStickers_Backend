---
description: Resolve a GitHub issue and open a PR (Backend Node.js)
---

# Workflow para Cascade: resolver un issue y abrir PR (Backend)

Usa este workflow cuando te pasen un numero o URL de issue de GitHub relacionado con el backend Node.js (`aiStickers_Backend`). El objetivo es tomar el issue, entenderlo, implementar una solucion, verificarla y abrir un Pull Request usando `gh`.

## Contexto del proyecto

- **Runtime**: Node.js (ESM, `"type": "module"`)
- **Framework**: Express
- **Entry point**: `index.js`
- **Estructura principal**: `src/controllers/`, `src/application/`, `src/domain/`, `src/config/`
- **Tests**: no hay test runner configurado actualmente; si se agrega, usar `npm test`
- **Linting**: no hay linter configurado actualmente; verificar `package.json` antes de asumir

## Entrada esperada

El usuario te pasara una de estas opciones:

- Numero de issue: `123`
- URL de issue: `https://github.com/OWNER/REPO/issues/123`
- Texto tipo: `resuelve el issue 123`

Si no puedes identificar claramente el repositorio o el numero de issue, pide solo ese dato y espera.

## Reglas generales

- Usa siempre `gh` para leer el issue, crear la rama y abrir el PR.
- Parte siempre desde `main` actualizado.
- Crea una rama nueva por issue.
- No hagas cambios no relacionados con el issue.
- No reescribas historial compartido.
- No cierres el issue manualmente salvo que el usuario lo pida.
- El PR debe tener una descripcion breve, suficiente para GitHub, sin texto enorme.
- Si hay tests o checks locales razonables, ejecutalos antes de abrir el PR.
- Si no puedes ejecutar tests, indicalo claramente en el PR.
- No expongas secretos ni credenciales en ningun archivo commiteado.

## Pasos

### 1. Identificar repo e issue

Si recibes una URL:

```bash
gh issue view ISSUE_URL --json number,title,body,labels,comments,url
```

Si ya estas dentro del repo y recibes un numero:

```bash
gh issue view ISSUE_NUMBER --json number,title,body,labels,comments,url
```

Guarda mentalmente:

- Numero del issue
- Titulo
- Problema esperado
- Criterios de aceptacion explicitos o implicitos
- Archivos o areas mencionadas (controller, use-case, domain, config, etc.)

### 2. Pasar a `main` y actualizar

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

Si el repo usa otra rama principal, detectala con:

```bash
gh repo view --json defaultBranchRef
```

### 3. Crear rama

La rama debe seguir este formato:

```text
issue-NUMERO-descripcion-corta
```

Ejemplo:

```bash
git checkout -b issue-42-fix-auth-token-expiry
```

Reglas para la descripcion:

- minusculas
- sin acentos
- palabras separadas por guiones
- maximo 5 o 6 palabras
- basada en el titulo del issue

### 4. Analizar y proponer solucion

Antes de editar:

1. Lee el codigo relacionado en `src/`.
2. Identifica la causa probable.
3. Decide la solucion minima correcta siguiendo la arquitectura existente (controllers → use-cases → domain → repositories).
4. Si hay varias opciones, elige la de menor riesgo y mas alineada con el estilo del repo.
5. Verifica que no haya secretos hardcodeados; las variables de entorno se gestionan via `.env` y `src/config/env.js`.

No abras el PR todavia. Primero implementa.

### 5. Implementar

Haz solo los cambios necesarios para resolver el issue.

Buenas practicas:

- Mantener el estilo ESM existente (`import`/`export`, no `require`).
- Seguir la arquitectura en capas: controllers no hacen logica de negocio, use-cases no acceden directamente a infraestructura.
- No modificar `.env` ni archivos de secretos; usa `.env.example` si necesitas documentar una nueva variable.
- Si el cambio toca logica verificable, agregar o actualizar tests (aunque actualmente no haya runner configurado).

### 6. Verificar

Comprueba primero si hay scripts disponibles:

```bash
cat package.json
```

Si hay script `test`:

```bash
npm test
```

Si hay script `lint`:

```bash
npm run lint
```

Si no hay ninguno configurado, verifica al menos que el servidor arranca sin errores:

```bash
node --check index.js
```

Y revisa que los archivos modificados tengan sintaxis valida:

```bash
node --check src/ARCHIVO_MODIFICADO.js
```

### 7. Revisar diff

```bash
git status --short
git diff
```

Confirma que:

- El diff esta enfocado en el issue.
- No hay archivos temporales (`*.log`, `node_modules/`, `.env`).
- No hay secretos ni credenciales.
- No hay cambios accidentales en archivos no relacionados.

### 8. Commit

Usa un commit corto y claro:

```bash
git add .
git commit -m "Fix issue NUMERO: descripcion corta"
```

Ejemplo:

```bash
git commit -m "Fix issue 42: auth token expiry handling"
```

### 9. Push

```bash
git push -u origin BRANCH_NAME
```

### 10. Crear PR con `gh`

Usa una descripcion breve. No debe ser enorme.

Formato recomendado:

```bash
gh pr create \
  --base main \
  --head BRANCH_NAME \
  --title "Fix issue NUMERO: TITULO_CORTO" \
  --body "## Summary
- Fixes the behavior described in #NUMERO.
- Implements the minimal code change needed for the issue.

## Tests
- COMMAND_OR_RESULT"
```

Si el PR debe cerrar automaticamente el issue, incluye `Fixes #NUMERO` en el body:

```bash
gh pr create \
  --base main \
  --head BRANCH_NAME \
  --title "Fix issue NUMERO: TITULO_CORTO" \
  --body "## Summary
- Fixes #NUMERO.
- Implements the requested behavior with a focused change.

## Tests
- COMMAND_OR_RESULT"
```

Si no se ejecutaron tests:

```text
## Tests
- Not run: no test runner configured. Verified syntax with `node --check`.
```

### 11. Responder al usuario

Al terminar, responde con:

- Link del PR.
- Resumen de 1 o 2 frases.
- Tests o verificaciones ejecutadas.
- Cualquier limitacion importante.

Ejemplo:

```text
PR creado: https://github.com/OWNER/REPO/pull/456

Resumen: corregi el manejo de expiracion del token JWT en el middleware de autenticacion.
Verificacion: node --check sobre los archivos modificados. Sin test runner configurado.
```

## Checklist final

- [ ] Issue leido con `gh issue view`.
- [ ] Rama principal actualizada.
- [ ] Rama creada con formato `issue-NUMERO-descripcion`.
- [ ] Solucion implementada siguiendo la arquitectura en capas.
- [ ] Sin secretos ni `.env` commiteado.
- [ ] Tests/checks razonables ejecutados o limitacion explicada.
- [ ] Diff revisado.
- [ ] Commit creado.
- [ ] Branch pusheada.
- [ ] PR creado con `gh pr create`.
- [ ] Respuesta final incluye link del PR y verificaciones.
