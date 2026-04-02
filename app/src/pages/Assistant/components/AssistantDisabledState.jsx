import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const AssistantDisabledState = () => (
    <div className="min-h-screen bg-zinc-950 px-4 py-16 text-slate-100">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200">Assistant Workspace</p>
            <h1 className="mt-4 text-3xl font-black text-white">Assistant v2 is currently disabled.</h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
                Enable `VITE_ASSISTANT_V2_ENABLED` in the app and `ASSISTANT_V2_ENABLED` on the server to use this
                workspace.
            </p>
            <Link
                to="/"
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white"
            >
                Return home
                <ArrowRight className="h-4 w-4" />
            </Link>
        </div>
    </div>
);

export default AssistantDisabledState;
