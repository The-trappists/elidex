import { CompanyBoard } from '../components/company/CompanyBoard'

/** Team company day. The public demo renders the same board with `publicDemo`. */
export default function CompanyPage() {
  return <CompanyBoard publicDemo={false} />
}
