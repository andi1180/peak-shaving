'use server'

import 'server-only'

import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { PROJECT_ID_PATTERN } from '@/lib/kalkulator/projects'

import { runProjectChatTurn, type ProjectChatTurnResult } from './agent'
import { callProjectChatModel } from './model'
import { composeEnergyAdvisorSystemPrompt } from './system-prompt'
import { buildEnergyAdvisorTools } from './tools'
import { createProjectChatPorts } from './supabase-ports'
import type { SendProjectChatMessageResult } from './chat'

/**
 * B24, Station 6 — der Endpunkt des Energieberaters. Vorbild `chat.ts`, mit EINEM Unterschied, der
 * den ganzen Zugang trägt: geprüft wird `isCurrentUserAdmin()`, nicht `project_accessible`. Der
 * Kunden-Chat lässt bewusst auch den Projekteigentümer durch — der Energieberater prüft dessen
 * eigene Angaben gegen, das darf der Kunde nicht selbst auslösen. Eine unbrauchbare Projekt-ID und
 * eine fehlende Adminrolle liefern deshalb dieselbe Antwort (`not_found`) — dieselbe
 * Nicht-Unterscheidbarkeit wie beim Kunden-Chat, nur an der Admin-Grenze statt der Kontogrenze.
 */
export async function sendEnergyAdvisorMessage(
  projectId: string,
  userMessage: string,
): Promise<SendProjectChatMessageResult> {
  if (!(await isCurrentUserAdmin())) return { status: 'not_found' }

  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    return { status: 'not_found' }
  }
  if (typeof userMessage !== 'string') return { status: 'empty_message' }

  const ports = createProjectChatPorts({})
  const extension = await ports.loadSystemPromptExtension('ki_check')

  return runProjectChatTurn(
    projectId,
    userMessage,
    {
      ports,
      callModel: callProjectChatModel,
      systemPromptText: composeEnergyAdvisorSystemPrompt(extension?.text ?? null),
      tools: buildEnergyAdvisorTools(),
    },
    [],
    'ki_check',
  )
}

export type { ProjectChatTurnResult }
