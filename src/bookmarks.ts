import fs from 'node:fs'
import path from 'node:path'

// Bookmarks for the interactive client. A flat JSON file in the state
// dir; refs are the canonical strings parseClientTarget round-trips.

export interface Bookmark {
  name: string
  ref: string
  addedAt: number
}

export class BookmarkStore {
  private file: string

  constructor(file: string) {
    this.file = file
  }

  list(): Bookmark[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (b): b is Bookmark =>
          typeof b === 'object' && b !== null &&
          typeof (b as Bookmark).name === 'string' &&
          typeof (b as Bookmark).ref === 'string',
      )
    } catch {
      return []
    }
  }

  // Returns false when the ref is already bookmarked.
  add(name: string, ref: string): boolean {
    const marks = this.list()
    if (marks.some((b) => b.ref === ref)) return false
    marks.push({ name, ref, addedAt: Math.floor(Date.now() / 1000) })
    this.write(marks)
    return true
  }

  // 1-based, matching the numbering shown to the user.
  remove(index: number): Bookmark | null {
    const marks = this.list()
    const removed = marks.splice(index - 1, 1)[0]
    if (removed === undefined) return null
    this.write(marks)
    return removed
  }

  private write(marks: Bookmark[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(marks, null, 2) + '\n')
  }
}
