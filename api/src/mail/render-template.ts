import * as fs from 'fs'
import * as path from 'path'
import * as handlebars from 'handlebars'

export const TEMPLATE_DIR = path.join(__dirname, 'templates')
const PARTIAL_DIR = path.join(TEMPLATE_DIR, 'partials')

// Context every template gets via the shared email-layout partial.
export const layoutContext = () => ({
  brandName: 'textbee.dev',
  year: new Date().getFullYear(),
})

let env: typeof handlebars | undefined
const compiled = new Map<string, handlebars.TemplateDelegate>()

const getEnv = () => {
  if (env) return env
  const created = handlebars.create()
  // Matches the mailer adapter, which registers this helper on construction.
  created.registerHelper('concat', (...args: any[]) => {
    args.pop()
    return args.join('')
  })
  if (fs.existsSync(PARTIAL_DIR)) {
    for (const file of fs.readdirSync(PARTIAL_DIR)) {
      if (!file.endsWith('.hbs')) continue
      created.registerPartial(
        path.basename(file, '.hbs'),
        fs.readFileSync(path.join(PARTIAL_DIR, file), 'utf8'),
      )
    }
  }
  env = created
  return env
}

/** Renders a mail template to HTML, without the CSS inlining pass. */
export const renderTemplate = (
  name: string,
  context: Record<string, any> = {},
): string => {
  const hbs = getEnv()
  let template = compiled.get(name)
  if (!template) {
    template = hbs.compile(
      fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.hbs`), 'utf8'),
    )
    compiled.set(name, template)
  }
  return template({ ...context, ...layoutContext() })
}
